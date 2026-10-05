export type PublishedPort = {
	service: string
	target: string
	published: string | null
	hostIp: string | null
	protocol: string
}

type ComposeServices = {services?: Record<string, {ports?: unknown}>}

/** Preserve bindings and ranges; a container-only declaration has a dynamic host port. */
export function getPublishedPorts(compose: ComposeServices | null): PublishedPort[] {
	return Object.entries(compose?.services ?? {}).flatMap(([service, config]) => {
		if (!Array.isArray(config?.ports)) return []
		return config.ports.flatMap((value): PublishedPort[] => {
			if (typeof value === 'object' && value !== null && 'target' in value) {
				return [
					{
						service,
						target: String(value.target),
						published: value.published == null ? null : String(value.published),
						hostIp: value.host_ip ?? null,
						protocol: value.protocol ?? 'tcp',
					},
				]
			}
			if (typeof value !== 'number' && typeof value !== 'string') return []
			const [binding, protocol = 'tcp'] = String(value).split('/')
			const parts = binding.split(':')
			const target = parts.pop()!
			const published = parts.pop() ?? null
			const hostIp = parts.length ? parts.join(':').replace(/^\[|\]$/g, '') : null
			return [{service, target, published, hostIp, protocol}]
		})
	})
}

export function fixedPublishedPort(binding: PublishedPort): number | null {
	if (!binding.published || !/^\d+$/.test(binding.published)) return null
	const port = Number(binding.published)
	return port > 0 && port <= 65535 ? port : null
}

/** Reserve every explicitly published host port, including ranges, regardless of protocol. */
export function publishedHostPorts(bindings: PublishedPort[]): number[] {
	const ports = new Set<number>()
	for (const binding of bindings) {
		const match = /^(\d+)(?:-(\d+))?$/.exec(binding.published ?? '')
		if (!match) continue
		const start = Number(match[1])
		const end = Number(match[2] ?? match[1])
		if (start < 1 || end > 65535 || end < start) continue
		for (let port = start; port <= end; port++) ports.add(port)
	}
	return [...ports]
}
