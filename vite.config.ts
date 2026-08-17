import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * The React Compiler is on.
 *
 * The editor's cost is not the work it does but how often it redoes it: a
 * stroke of the brush is a state change per cell it crosses, and each one used
 * to rebuild the whole sidebar — every colour swatch, every motif, every
 * button — because the JSX for it is written inline and so was new each time.
 * None of it had changed.
 *
 * Memoising that by hand means wrapping a few hundred lines of JSX in `useMemo`
 * and maintaining the dependency lists forever after; the compiler works out
 * the same dependencies from the code itself and cannot fall out of step with
 * it. The lint already holds this codebase to the compiler's rules
 * (`reactHooks.configs.flat.recommended` in `eslint.config.js` includes them,
 * and passes), so nothing here had to change to turn it on.
 */
// https://vite.dev/config/
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
})
