import RFBModule from '@novnc/novnc'

type RFBConstructor = typeof RFBModule

// noVNC ships Babel CommonJS. Vite's dev optimizer unwraps its default export,
// while production Rolldown uses Node interop for this ESM package and returns
// module.exports. Resolve that boundary here, without changing other imports.
const module = RFBModule as RFBConstructor | {default: RFBConstructor}
export const RFB = typeof module === 'function' ? module : module.default
export type RFB = InstanceType<RFBConstructor>
