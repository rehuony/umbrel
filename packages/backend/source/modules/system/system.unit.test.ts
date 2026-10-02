import {describe, afterEach, expect, test, vi} from 'vitest'
import os from 'node:os'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'
import fse from 'fs-extra'

import Umbreld from '../../index.js'
import {getCpuTemperature, getMemoryUsage, getDiskUsage, getDiskUsageByPath, shutdown, reboot} from './system.js'
import {systemWidgets} from './system-widgets.js'

vi.mock('systeminformation')
vi.mock('execa')
vi.mock('fs-extra')

afterEach(() => {
	vi.resetAllMocks()
})

describe('CPU widget', () => {
	const umbreld = {
		apps: {instances: []},
		machines: {runtimeResourceUsage: async () => ({cpu: []})},
	} as unknown as Umbreld

	test.each([
		{usage: 24, text: '24%', progress: 0.24, idle: '76%'},
		{usage: 0.1, text: '0.10%', progress: 0.001, idle: '100%'},
		{usage: 0, text: '0.0%', progress: 0, idle: '100%'},
		{usage: 99.8, text: '100%', progress: 0.998, idle: '0.20%'},
		{usage: 100, text: '100%', progress: 1, idle: '0.0%'},
		{usage: 110, text: '100%', progress: 1, idle: '0.0%'},
		{usage: -1, text: '0.0%', progress: 0, idle: '100%'},
	])('returns total-system usage and bounded progress for $usage%', async ({usage, text, progress, idle}) => {
		vi.mocked(execa.$, {partial: true}).mockResolvedValue({stdout: `PID %CPU\n1 ${usage * os.cpus().length}`})
		const widget = await systemWidgets.cpu(umbreld)
		expect(widget).toMatchObject({
			type: 'text-with-progress',
			title: 'CPU',
			text,
			progressLabel: `${idle} idle`,
			link: '/live-usage?tab=cpu',
			refresh: '10s',
		})
		expect(widget.progress).toBeCloseTo(progress, 6)
	})

	test('propagates sampling failures instead of displaying a fabricated idle reading', async () => {
		vi.mocked(execa.$).mockRejectedValue(new Error('CPU sampling failed'))
		await expect(systemWidgets.cpu(umbreld)).rejects.toThrow('CPU sampling failed')
	})
})

describe('getCpuTemperature', () => {
	test('should return main cpu temperature when system supports it', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 69} as any)
		expect(await getCpuTemperature()).toMatchObject({warning: 'normal', temperature: 69})
	})

	test('should keep temperature warnings disabled during the 2.0 beta', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 100} as any)
		expect(await getCpuTemperature()).toMatchObject({warning: 'normal', temperature: 100})
	})

	test('should throw error when system does not support cpu temperature', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: null} as any)
		await expect(getCpuTemperature()).rejects.toThrow('Could not get CPU temperature')
	})
})

describe('getDiskUsageByPath', () => {
	test('should return disk usage for specified path', async () => {
		vi.mocked(execa.$, {partial: true}).mockResolvedValue({
			stdout: `   1B-blocks         Used        Avail
290821033984 126167117824 164653916160`,
		})
		expect(await getDiskUsageByPath('/tmp')).toMatchObject({
			size: 290821033984,
			totalUsed: 126167117824,
			available: 164653916160,
		})
	})
})

describe('getDiskUsage', () => {
	test('keeps filesystem capacity live while using Files and app directory aggregates', async () => {
		vi.mocked(execa.$, {partial: true}).mockResolvedValue({
			stdout: `1B-blocks Used Avail
1000 800 200`,
		})
		const getStorageUsage = vi.fn(async () => 130)
		const getAppDiskUsage = vi.fn(async () => 70)
		const storageResourceUsage = vi.fn(async () => [{id: 'machine', name: 'Machine', osId: 'linux', used: 110}])
		const umbreld = {
			dataDirectory: '/data',
			hardware: {umbrelPro: {isUmbrelPro: vi.fn(async () => false)}},
			apps: {instances: [{id: 'app', getDiskUsage: getAppDiskUsage}]},
			machines: {storageResourceUsage},
			files: {getStorageUsage},
		} as unknown as Umbreld

		await expect(getDiskUsage(umbreld)).resolves.toMatchObject({
			size: 1000,
			totalUsed: 800,
			available: 200,
			files: 130,
			apps: [{id: 'app', used: 70}],
			machines: [{id: 'machine', used: 110}],
		})
		expect(execa.$).toHaveBeenCalledOnce()
		expect(getStorageUsage).toHaveBeenCalledOnce()
		expect(getAppDiskUsage).toHaveBeenCalledOnce()
		expect(storageResourceUsage).toHaveBeenCalledOnce()
	})
})

describe('getMemoryUsage', () => {
	test('should return memory usage', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		vi.mocked(fse.readFile).mockImplementation(async (path) => {
			if (path === '/proc/meminfo') {
				return (
					'MemTotal:        1000 kB\n' +
					'MemAvailable:     360 kB\n' +
					'MemFree:          100 kB\n' +
					'Buffers:           50 kB\n' +
					'Cached:           200 kB\n' +
					'SReclaimable:      30 kB\n' +
					'Shmem:             20 kB\n'
				)
			}
			throw new Error('ENOENT')
		})
		vi.mocked(execa.$, {partial: true}).mockResolvedValue({
			stdout: '1 100',
		})
		expect(await getMemoryUsage(umbreld)).toMatchObject({
			size: 1_024_000,
			totalUsed: 655_360, // 1000kB - 360kB
		})
	})

	test('should clamp memory outputs to non-negative values within total size', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		;(umbreld.apps as any).instances = [
			{
				id: 'test-app',
				getContainerNames: async () => ['test_web_1'],
			},
		]
		vi.mocked(execa.$, {partial: true}).mockImplementation(async (...args: any[]) => {
			const template = args[0]
			const str = Array.isArray(template) ? template.join('') : String(template)
			if (str.includes('docker ps')) {
				return {stdout: 'abc123def456|test_web_1'} as any
			}
			return {stdout: ''} as any
		})
		vi.mocked(fse.readFile).mockImplementation(async (path) => {
			if (path === '/proc/meminfo') {
				return (
					'MemTotal:        1000 kB\n' +
					'MemFree:            0 kB\n' +
					'Buffers:            0 kB\n' +
					'Cached:             0 kB\n' +
					'SReclaimable:       0 kB\n' +
					'Shmem:           2000 kB\n'
				)
			}
			if (String(path).includes('memory.current')) {
				return '5120000'
			}
			if (String(path).includes('memory.stat')) {
				return 'inactive_file 0\n'
			}
			if (String(path).includes('memory.swap.current')) {
				return '5120000'
			}
			if (path === '/sys/block/zram0/mm_stat') {
				return '1 0 2'
			}
			throw new Error('ENOENT')
		})

		expect(await getMemoryUsage(umbreld)).toMatchObject({
			size: 1_024_000,
			totalUsed: 1_024_000,
			system: 0,
			apps: [{id: 'test-app', used: 1_024_000}],
		})
	})
})

describe('shutdown', () => {
	test('should call execa.$ with "poweroff"', async () => {
		expect(await shutdown()).toBe(true)
		expect(execa.$).toHaveBeenCalledWith(['poweroff'])
	})

	test('should throw error when "poweroff" command fails', async () => {
		vi.mocked(execa.$, {partial: true}).mockRejectedValue(new Error('Failed'))
		await expect(shutdown()).rejects.toThrow()
	})
})

describe('reboot', () => {
	test('should call execa.$ with "reboot"', async () => {
		expect(await reboot()).toBe(true)
		expect(execa.$).toHaveBeenCalledWith(['reboot'])
	})

	test('should throw error when "shutdown" command fails', async () => {
		vi.mocked(execa.$, {partial: true}).mockRejectedValue(new Error('Failed'))
		await expect(reboot()).rejects.toThrow()
	})
})
