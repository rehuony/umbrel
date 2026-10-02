import prettyBytes from 'pretty-bytes'

import type Umbreld from '../../index.js'
import {getSystemDiskUsage, getSystemMemoryUsage, getCpuUsage} from './system.js'

// Keep CPU labels consistent and avoid scientific notation near full usage.
function formatCpuUsage(usage: number) {
	if (usage >= 99.5) return '100%'
	return `${usage.toPrecision(2)}%`
}

export const systemWidgets = {
	cpu: async function (umbreld: Umbreld) {
		const {totalUsed} = await getCpuUsage(umbreld)
		const usage = Math.min(100, Math.max(0, totalUsed))

		return {
			type: 'text-with-progress',
			link: '/live-usage?tab=cpu',
			refresh: '10s',
			title: 'CPU',
			text: formatCpuUsage(usage),
			progressLabel: `${formatCpuUsage(100 - usage)} idle`,
			progress: usage / 100,
		}
	},
	storage: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getSystemDiskUsage(umbreld)

		return {
			type: 'text-with-progress',
			link: '/live-usage?tab=storage',
			refresh: '30s',
			title: 'Storage',
			text: prettyBytes(totalUsed),
			subtext: `/ ${prettyBytes(size)}`,
			progressLabel: `${prettyBytes(size - totalUsed)} left`,
			progress: (totalUsed / size).toFixed(2),
		}
	},
	memory: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getSystemMemoryUsage()

		return {
			type: 'text-with-progress',
			link: '/live-usage?tab=memory',
			refresh: '10s',
			title: 'Memory',
			text: prettyBytes(totalUsed),
			subtext: `/ ${prettyBytes(size)}`,
			progressLabel: `${prettyBytes(size - totalUsed)} left`,
			progress: (totalUsed / size).toFixed(2),
		}
	},
	'system-stats': async function (umbreld: Umbreld) {
		const [cpuUsage, diskUsage, memoryUsage] = await Promise.all([
			getCpuUsage(umbreld),
			getSystemDiskUsage(umbreld),
			getSystemMemoryUsage(),
		])

		const {totalUsed: cpuTotalUsed} = cpuUsage
		const {totalUsed: diskTotalUsed} = diskUsage
		const {totalUsed: memoryTotalUsed} = memoryUsage

		return {
			type: 'three-stats',
			link: '/live-usage',
			refresh: '10s',
			items: [
				{
					icon: 'system-widget-cpu',
					subtext: 'CPU',
					text: formatCpuUsage(cpuTotalUsed),
				},
				{
					icon: 'system-widget-memory',
					subtext: 'Memory',
					text: `${prettyBytes(memoryTotalUsed)}`,
				},
				{
					icon: 'system-widget-storage',
					subtext: 'Storage',
					text: `${prettyBytes(diskTotalUsed)}`,
				},
			],
		}
	},
}
