import {expect, test} from 'vitest'
import {fixedPublishedPort, getPublishedPorts, publishedHostPorts} from './compose-ports.js'

test('distinguishes fixed, dynamic, ranged, IPv6 and long Compose port mappings', () => {
	const bindings = getPublishedPorts({
		services: {
			ui: {ports: ['18080:8080', '[::1]:18443:443', 9000]},
			api: {
				ports: [
					{target: 8081, published: '18081', host_ip: '10.0.0.2', app_protocol: 'http'},
					'19000-19002:9000-9002/udp',
					'${API_PORT}:80',
				],
			},
		},
	})
	expect(bindings).toEqual([
		{service: 'ui', target: '8080', published: '18080', hostIp: null, protocol: 'tcp'},
		{service: 'ui', target: '443', published: '18443', hostIp: '::1', protocol: 'tcp'},
		{service: 'ui', target: '9000', published: null, hostIp: null, protocol: 'tcp'},
		{service: 'api', target: '8081', published: '18081', hostIp: '10.0.0.2', protocol: 'tcp'},
		{service: 'api', target: '9000-9002', published: '19000-19002', hostIp: null, protocol: 'udp'},
		{service: 'api', target: '80', published: '${API_PORT}', hostIp: null, protocol: 'tcp'},
	])
	expect(bindings.map(fixedPublishedPort)).toEqual([18080, 18443, null, 18081, null, null])
	expect(publishedHostPorts(bindings)).toEqual([18080, 18443, 18081, 19000, 19001, 19002])
})

test('does not reserve dynamic, malformed or out of range host ports', () => {
	expect(
		publishedHostPorts(
			getPublishedPorts({services: {web: {ports: ['0:80', '65536:80', '65535-65536:80-81', '2-1:80-81', '8080']}}}),
		),
	).toEqual([])
	expect(getPublishedPorts(null)).toEqual([])
})
