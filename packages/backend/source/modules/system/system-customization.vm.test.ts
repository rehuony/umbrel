import {randomUUID} from 'node:crypto'

import {afterEach, expect, test} from 'vitest'
import pWaitFor from 'p-wait-for'
import {WebSocket} from 'ws'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import {triggerFactoryReset, triggerRebootingAction} from '../test-utilities/rebooting-action.js'

let host: Awaited<ReturnType<typeof createTestVm>> | undefined

afterEach(async () => {
	await host?.cleanup()
	host = undefined
})

test('restores the customized image on reboot while preserving user configuration and data', async () => {
	host = await createTestVm({device: 'umbrel-home'})
	const system = host
	await system.vm.powerOn()
	await system.registerAndLogin()

	// Use the existing owner terminal: fresh images have no authorized SSH keys.
	// Test credentials stay in the disposable VM; no key or password SSH override
	// is injected into the image to make this scenario pass.
	async function runInTerminal(command: string, asRoot = false) {
		const ticket = await system.client.user.createWebSocketTicket.mutate({target: 'terminal'})
		const socket = new WebSocket(`ws://127.0.0.1:${system.vm.httpPort}/terminal?cols=160&rows=24&ticket=${ticket}`)
		const marker = `__terminal_${randomUUID().replaceAll('-', '')}__`
		const script = `printf %s ${Buffer.from(command).toString('base64')} | base64 -d | /bin/bash`
		const invocation = asRoot ? `printf '%s\\n' 'moneyprintergobrrr' | sudo -S -p '' /bin/bash -c "${script}"` : script
		let output = ''
		let socketError: Error | undefined
		socket.on('message', (data) => (output += data.toString()))
		socket.on('error', (error) => (socketError = error))
		try {
			await pWaitFor(
				() => {
					if (socketError) throw socketError
					return output.includes('umbrel@') && output.includes('$')
				},
				{interval: 100, timeout: 15_000},
			)
			socket.send(
				`terminal_output=$(${invocation} 2>&1); terminal_code=$?; printf '\\n${marker}%s:%s\\n' "$terminal_code" "$(printf %s "$terminal_output" | base64 -w0)"\r`,
			)
			const resultPattern = new RegExp(`${marker}(\\d+):([A-Za-z0-9+/=]*)[\\r\\n]`)
			await pWaitFor(
				() => {
					if (socketError) throw socketError
					return resultPattern.test(output)
				},
				{interval: 100, timeout: 60_000},
			).catch((error) => {
				throw new Error(`Guest terminal did not return a result: ${output.slice(-4000)}`, {cause: error})
			})
			const result = output.match(resultPattern)!
			const decoded = Buffer.from(result[2], 'base64').toString()
			if (result[1] !== '0') throw new Error(`Guest command failed (${result[1]}): ${decoded}`)
			return decoded
		} finally {
			socket.terminate()
		}
	}

	const runAsRoot = (command: string) => runInTerminal(command, true)

	const readBootId = async () => (await runInTerminal('cat /proc/sys/kernel/random/boot_id')).trim()
	const originalLocaleConfig = await runInTerminal('cat /etc/locale.conf')

	const imageDefaults = await runAsRoot(`set -eu
dpkg-query -W -f='\${Status}' zsh | grep -qx 'install ok installed'
dpkg-query -W -f='\${Status}' eza | grep -qx 'install ok installed'
test "$(getent passwd umbrel | cut -d: -f7)" = /bin/bash
test -f /home/umbrel/.bashrc
echo image-customization-installed
`)
	expect(imageDefaults.trim()).toBe('image-customization-installed')

	async function assertSystemDefaults() {
		const defaults = await runAsRoot(`set -eu
for account in umbrel root; do
    test "$(getent passwd "$account" | cut -d: -f7)" = /bin/bash
    # Keep nested interactive shells from taking over the Web terminal's TTY.
    setsid --wait sudo -H -u "$account" env TERM=xterm-ghostty bash -lic 'alias ll; alias la; alias l; alias cls; alias quit; printf "prompt=%s\\n" "$PS1"' </dev/null
done
infocmp -x -A /usr/share/terminfo xterm-ghostty >/dev/null
test "$(env -u TERMINFO -u TERMINFO_DIRS TERM=xterm-ghostty tput colors)" = 256
sshd -t
for account in umbrel root; do
    policy=$(sshd -T -C "user=$account,host=localhost,addr=127.0.0.1")
    for expected in 'port 22' 'pubkeyauthentication yes' 'authenticationmethods publickey' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitemptypasswords no' 'permitrootlogin without-password' 'clientaliveinterval 60' 'clientalivecountmax 3'; do
        printf '%s\\n' "$policy" | grep -qx "$expected"
    done
done
test ! -e /home/umbrel/.ssh/authorized_keys
test ! -e /root/.ssh/authorized_keys
`)
		expect(defaults).toContain("alias ll='ls -lAF'")
		expect(defaults).toContain("alias cls='clear'")
		expect(defaults).toContain('alias quit=')
		expect(defaults).toContain('01;31m')
		expect(defaults).toContain('01;32m')
	}
	await assertSystemDefaults()

	async function assertWebShell() {
		const ticket = await system.client.user.createWebSocketTicket.mutate({target: 'terminal'})
		const socket = new WebSocket(`ws://127.0.0.1:${system.vm.httpPort}/terminal?cols=120&rows=24&ticket=${ticket}`)
		let output = ''
		let socketError: Error | undefined
		socket.on('message', (data) => (output += data.toString()))
		socket.on('error', (error) => (socketError = error))
		try {
			await pWaitFor(
				() => {
					if (socketError) throw socketError
					return output.includes('umbrel@') && output.includes('$')
				},
				{interval: 100, timeout: 15_000},
			)
			socket.send(`printf 'shell=%s marker=%s home=%s\\n' "$BASH_VERSION" "$PANEL_CUSTOMIZATION_MARKER" "$HOME"\r`)
			await pWaitFor(
				() => {
					if (socketError) throw socketError
					// Match evaluated values, not the PTY's echo of the input command.
					return /shell=\d+\.\S+ marker=personal-bash home=\/home\/umbrel/.test(output)
				},
				{interval: 100, timeout: 15_000},
			)
		} finally {
			socket.terminate()
		}
	}

	async function reboot() {
		const previousBootId = await readBootId()
		// Exercise an actual guest reboot. The harness's powerOff() can fall back
		// to killing QEMU, which would not establish normal reboot persistence.
		await triggerRebootingAction(system.client.system.restart.mutate())
		await pWaitFor(
			async () => {
				try {
					if (!(await system.unauthenticatedClient.user.exists.query())) return false
					await system.login()
					return (await readBootId()) !== previousBootId
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 180_000},
		)
		await system.login()
	}

	// Install a tiny local Debian package through apt, without network access.
	// Its database entry and files must both disappear with the temporary root.
	await runAsRoot(`set -eu
package_dir=$(mktemp -d)
trap 'rm -rf "$package_dir"' EXIT
mkdir -p "$package_dir/package/DEBIAN" "$package_dir/package/usr/bin"
cat > "$package_dir/package/DEBIAN/control" <<'CONTROL'
Package: panel-persistence-test
Version: 1.0
Architecture: all
Maintainer: System Tests <tests@example.invalid>
Description: Offline fixture for discarded runtime changes
CONTROL
cat > "$package_dir/package/usr/bin/panel-persistence-test" <<'PROGRAM'
#!/bin/sh
printf 'persistent-package\\n'
PROGRAM
chmod 755 "$package_dir/package/usr/bin/panel-persistence-test"
dpkg-deb --build "$package_dir/package" "$package_dir/package.deb"
apt-get --yes install "$package_dir/package.deb"

# Exercise creation, modification, permissions, and a lower-layer deletion.
printf 'persistent-config\\n' > /etc/panel-persistence-test.conf
printf 'persistent-root-home\\n' > /root/panel-persistence-test
chmod 600 /root/panel-persistence-test
printf 'persistent-opt\\n' > /opt/panel-persistence-test
printf 'persistent-var\\n' > /var/lib/panel-persistence-test
printf '# persistent-config-marker\\n' >> /etc/locale.conf
printf '\\nexport PANEL_CUSTOMIZATION_MARKER=personal-bash\\n' >> /home/umbrel/.bashrc
test -f /etc/issue
rm /etc/issue

cat > /etc/systemd/system/panel-persistence-test.service <<'UNIT'
[Unit]
Description=Verify temporary custom services are discarded
[Service]
Type=oneshot
ExecStart=/usr/bin/panel-persistence-test
StandardOutput=file:/run/panel-persistence-test
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable panel-persistence-test.service
`)
	await system.api.post('files/upload?path=/Home/system-customization-test.txt', {body: 'persistent-user-data'})
	await assertWebShell()

	async function assertRestoredState() {
		const output = await runAsRoot(`set -eu
test ! -e /etc/panel-persistence-test.conf
test ! -e /root/panel-persistence-test
test ! -e /opt/panel-persistence-test
test ! -e /var/lib/panel-persistence-test
test ! -e /usr/bin/panel-persistence-test
test ! -e /etc/systemd/system/panel-persistence-test.service
test ! -e /etc/systemd/system/multi-user.target.wants/panel-persistence-test.service
test ! -e /run/panel-persistence-test
test -f /etc/issue
if dpkg-query -W panel-persistence-test >/dev/null 2>&1; then exit 1; fi
dpkg-query -W -f='\${Status}' zsh | grep -qx 'install ok installed'
dpkg-query -W -f='\${Status}' eza | grep -qx 'install ok installed'
test "$(getent passwd umbrel | cut -d: -f7)" = /bin/bash
grep -qx 'export PANEL_CUSTOMIZATION_MARKER=personal-bash' /home/umbrel/.bashrc
echo image-state-restored
`)
		expect(output.trim()).toBe('image-state-restored')
		expect(await runInTerminal('cat /etc/locale.conf')).toBe(originalLocaleConfig)
		const home = await system.client.files.list.query({path: '/Home'})
		expect(home.files.map((file) => file.name)).toContain('system-customization-test.txt')
		await assertWebShell()
		await assertSystemDefaults()
	}

	await reboot()
	await assertRestoredState()
	// Check a second boot preserves the same user data and image defaults.
	await reboot()
	await assertRestoredState()

	// Factory reset is an explicit destructive operation and must still restore
	// the image defaults, including files deleted from the read-only base.
	await triggerFactoryReset(system.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'}))
	await pWaitFor(
		async () => {
			try {
				return !(await system.unauthenticatedClient.user.exists.query())
			} catch {
				return false
			}
		},
		{interval: 2000, timeout: 180_000},
	)
	await system.registerAndLogin()
	const reset = await runAsRoot(`set -eu
test ! -e /etc/panel-persistence-test.conf
test ! -e /root/panel-persistence-test
test ! -e /opt/panel-persistence-test
test ! -e /var/lib/panel-persistence-test
test ! -e /usr/bin/panel-persistence-test
test ! -e /etc/systemd/system/panel-persistence-test.service
test ! -e /etc/systemd/system/multi-user.target.wants/panel-persistence-test.service
test ! -e /run/panel-persistence-test
test -f /etc/issue
if dpkg-query -W panel-persistence-test >/dev/null 2>&1; then exit 1; fi
dpkg-query -W -f='\${Status}' zsh | grep -qx 'install ok installed'
dpkg-query -W -f='\${Status}' eza | grep -qx 'install ok installed'
test "$(getent passwd umbrel | cut -d: -f7)" = /bin/bash
test -f /home/umbrel/.bashrc
if grep -q PANEL_CUSTOMIZATION_MARKER /home/umbrel/.bashrc; then exit 1; fi
echo factory-state-restored
`)
	expect(reset.trim()).toBe('factory-state-restored')
	await assertSystemDefaults()
	expect(await runInTerminal('cat /etc/locale.conf')).toBe(originalLocaleConfig)
	const home = await system.client.files.list.query({path: '/Home'})
	expect(home.files.map((file) => file.name)).not.toContain('system-customization-test.txt')
}, 600_000)
