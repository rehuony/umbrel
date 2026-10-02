import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {execa} from 'execa'
import {expect, test} from 'vitest'

import LanIngress from './lan-ingress.js'

// Run in Linux with CAP_SYS_ADMIN and CAP_NET_ADMIN. All links, listeners and
// firewall rules live in disposable namespaces, never the host network.
test.skipIf(process.platform !== 'linux')(
	'blocks proxy bypass before DNAT while retaining web ingress and other LAN peers',
	async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'external-proxy-'))
		const logger = {createChildLogger: () => logger}
		const ingress = new LanIngress({
			dataDirectory: directory,
			logger,
			externalAccess: {
				settings: {enabled: false, trustedProxies: ['100.64.0.10', 'fd00::10']},
			},
		} as never) as unknown as {buildNftRuleset(routes: unknown[], hidden: unknown[]): string}
		try {
			await writeFile(`${directory}/rules.nft`, ingress.buildNftRuleset([], []))
			await writeFile(
				`${directory}/server.py`,
				`import http.server, threading, time
for port in [80, 443, 9000]:
    server = http.server.HTTPServer(('0.0.0.0', port), http.server.BaseHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
open('server.ready', 'w').close()
time.sleep(60)
`,
			)
			const {stdout} = await execa(
				'unshare',
				[
					'--mount',
					'--net',
					'--',
					'bash',
					'-eu',
					'-c',
					`
unshare --net -- sh -c 'touch peer.ready; exec sleep 60' &
peer=$!
server=''
trap 'kill "$peer" $server 2>/dev/null || true; wait 2>/dev/null || true' EXIT
for i in $(seq 1 100); do test -e peer.ready && break; sleep .02; done
test -e peer.ready
ip link set lo up
ip link add gateway type veth peer name client
ip link set client netns "$peer"
ip addr add 100.64.0.1/24 dev gateway
ip link set gateway up
nsenter -t "$peer" -n ip link set lo up
nsenter -t "$peer" -n ip addr add 100.64.0.10/24 dev client
nsenter -t "$peer" -n ip addr add 100.64.0.11/24 dev client
nsenter -t "$peer" -n ip link set client up
nft -f rules.nft
# Model Docker's later port publishing: the guard must inspect the original port.
nft 'add table ip publish'
nft 'add chain ip publish pre { type nat hook prerouting priority dstnat; }'
nft 'add rule ip publish pre tcp dport 9100 redirect to :9000'
python3 server.py >/dev/null 2>&1 &
server=$!
for i in $(seq 1 100); do test -e server.ready && break; sleep .02; done
test -e server.ready
for port in 80 443; do
  nsenter -t "$peer" -n curl --noproxy '*' --silent --output /dev/null --max-time 2 --interface 100.64.0.10 "http://100.64.0.1:$port"
done
for port in 9000 9100; do
  result=0
  nsenter -t "$peer" -n curl --noproxy '*' --silent --output /dev/null --max-time 0.3 --interface 100.64.0.10 "http://100.64.0.1:$port" || result=$?
  test "$result" -eq 28
  nsenter -t "$peer" -n curl --noproxy '*' --silent --output /dev/null --max-time 2 --interface 100.64.0.11 "http://100.64.0.1:$port"
done
echo verified
`,
				],
				{cwd: directory, timeout: 15_000},
			)
			expect(stdout.trim()).toBe('verified')
		} finally {
			await rm(directory, {recursive: true, force: true})
		}
	},
	20_000,
)
