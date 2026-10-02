import {expect} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

export type PiTestVm = Awaited<ReturnType<typeof createTestVm>>

type LsblkDevice = {
	name: string
	type: string
	tran?: string | null
	label?: string | null
	uuid?: string | null
	children?: LsblkDevice[]
}

// Pi first boot performs Rugix's A/B bootstrap through a TCG-emulated SD card.
export const piStartupTimeout = 2_700_000

export async function getUsbDisks(umbreld: PiTestVm) {
	const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN')) as {
		blockdevices: LsblkDevice[]
	}
	return blockdevices.filter((device) => device.type === 'disk' && device.tran === 'usb')
}

export async function waitForUsbDisks(umbreld: PiTestVm, count: number) {
	let disks: LsblkDevice[] = []
	await pRetry(
		async () => {
			disks = await getUsbDisks(umbreld)
			expect(disks).toHaveLength(count)
		},
		{retries: 60, minTimeout: 1000, maxTimeout: 1000},
	)
	return disks
}

export async function waitForUsbPartitionByUuid(umbreld: PiTestVm, uuid: string) {
	let deviceId = ''
	await pRetry(
		async () => {
			const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,UUID')) as {
				blockdevices: LsblkDevice[]
			}
			const disk = blockdevices.find(
				(device) =>
					device.type === 'disk' &&
					device.tran === 'usb' &&
					device.children?.some((partition) => partition.type === 'part' && partition.uuid === uuid),
			)
			expect(disk).toBeDefined()
			deviceId = disk!.name
		},
		{retries: 120, minTimeout: 1000, maxTimeout: 1000},
	)
	return deviceId
}
