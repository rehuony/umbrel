import {useReducedMotion} from 'motion/react'
import {useCallback, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {EXIT_DURATION_MS, useAfterDelayedClose} from '@/utils/dialog'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)
	const reduceMotion = useReducedMotion()
	const returnToDesktop = useCallback(() => navigate('/'), [navigate])
	// Match the shared sheet's exit animation and cancel navigation on unmount.
	useAfterDelayedClose(open, returnToDesktop, reduceMotion ? 0 : EXIT_DURATION_MS)

	return <WidgetSelector open={open} onOpenChange={setOpen} />
}
