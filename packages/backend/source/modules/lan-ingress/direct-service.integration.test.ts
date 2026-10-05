import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {expect, test} from 'vitest'
import LanIngress from './lan-ingress.js'

// Requires Linux with CAP_SYS_ADMIN and CAP_NET_ADMIN. All links, listeners and
// rules live in disposable namespaces, never the host network.
test.skipIf(process.platform !== 'linux')(
	'allows published service ports while guarding hidden listeners and replacing obsolete chains',
	async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-service-'))
		const logger = {createChildLogger: () => logger}
		const ingress = new LanIngress({dataDirectory: directory, logger} as never) as unknown as {
			buildNftRuleset(routes: unknown[], hidden: unknown[]): string
		}
		try {
			const routes = [{publicPort: 8080, hiddenPort: 23000}]
			await writeFile(`${directory}/rules.nft`, ingress.buildNftRuleset(routes, routes))
			await writeFile(
				`${directory}/server.py`,
				`import http.server, threading, time
for port in [80, 443, 9000, 23000]:
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
nsenter -t "$peer" -n ip link set client up
# Initial application must work with no previous table.
nft -f rules.nft
# A superseded hook must disappear completely at the next reconciliation.
nft 'add chain inet umbrel_lan_ingress obsolete_guard { type filter hook prerouting priority dstnat - 2; policy accept; }'
nft 'add rule inet umbrel_lan_ingress obsolete_guard ip saddr 100.64.0.10 tcp dport != { 80, 443 } drop'
nft -f rules.nft
if nft list table inet umbrel_lan_ingress | grep -q obsolete_guard; then exit 1; fi
# Model Docker publishing a secondary service port after ingress routing.
nft 'add table ip publish'
nft 'add chain ip publish pre { type nat hook prerouting priority dstnat; }'
nft 'add rule ip publish pre tcp dport 9100 redirect to :9000'
python3 server.py >/dev/null 2>&1 &
server=$!
for i in $(seq 1 100); do test -e server.ready && break; sleep .02; done
test -e server.ready
for port in 80 443 8080 9000 9100; do
 nsenter -t "$peer" -n curl --noproxy '*' --silent --output /dev/null --max-time 2 "http://100.64.0.1:$port"
done
result=0
nsenter -t "$peer" -n curl --noproxy '*' --silent --output /dev/null --max-time 0.3 http://100.64.0.1:23000 || result=$?
test "$result" -eq 28
echo verified
`,
				],
				{cwd: directory, timeout: 15000},
			)
			expect(stdout.trim()).toBe('verified')
		} finally {
			await rm(directory, {recursive: true, force: true})
		}
	},
	20000,
)
