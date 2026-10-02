import {yaml} from '@codemirror/lang-yaml'
import {EditorView} from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import {useMemo} from 'react'

import {umbrelTheme} from '@/features/files/components/file-viewer/text-viewer/umbrel-theme'

const yamlLanguage = yaml()
const basicSetup = {
	foldGutter: false,
	autocompletion: false,
	highlightActiveLine: false,
	highlightActiveLineGutter: false,
}

export default function ComposeEditor({
	value,
	onChange,
	readOnly,
	label,
	placeholder,
}: {
	value: string
	onChange: (value: string) => void
	readOnly: boolean
	label: string
	placeholder: string
}) {
	const extensions = useMemo(() => [yamlLanguage, EditorView.contentAttributes.of({'aria-label': label})], [label])
	return (
		<CodeMirror
			value={value}
			onChange={onChange}
			readOnly={readOnly}
			theme={umbrelTheme}
			extensions={extensions}
			basicSetup={basicSetup}
			indentWithTab={false}
			placeholder={placeholder}
			height='100%'
			style={{height: '100%'}}
			aria-label={label}
		/>
	)
}
