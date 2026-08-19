import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest configuration for the Teletext Workshop.
// - Pure domain logic (src/domain) is framework-free and runs fine under jsdom.
// - React component/integration tests (added later) require a DOM, so jsdom is
//   the default environment.
// Run via `bun run test` (single-run) or `bun run test:watch`.
export default defineConfig({
  // The same React Compiler pass the app is built with (see `vite.config.ts`),
  // so the components under test are the components that ship rather than an
  // unmemoised version of them.
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
  test: {
    globals: true,
    environment: 'jsdom',
    /*
     * Five seconds is not enough for the property suites.
     *
     * `src/domain` is checked with fast-check rather than by example, and a
     * property that generates a few hundred 960-cell pages and compares each
     * against an oracle legitimately takes seconds. Against the default they
     * passed alone and timed out perhaps one run in three alongside everything
     * else — which reads as a flaky assertion and is nothing of the kind, so it
     * would have been chased in the wrong place.
     *
     * Raised rather than the generators trimmed: the coverage is the point, and
     * a slow test that is allowed to finish costs a few seconds of CI once.
     *
     * Thirty and not twenty because the slowest of them — Property 20, which
     * normalizes two hundred pages of junk — takes four seconds with the machine
     * to itself and comfortably four times that with the rest of the suite
     * running beside it. Per-test timeouts are deliberately not used: a smaller
     * number written at one `it` silently wins over this one, which is how that
     * property came to fail against a limit nobody could find in the config.
     */
    testTimeout: 30000,
    setupFiles: ['./src/test/setup.ts'],
    // `api/` holds the serverless routes and their auth/session logic, which is
    // security-relevant and worth the same coverage as the domain modules.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'api/**/*.{test,spec}.ts'],
    // No tests exist yet during initial setup; don't fail the run.
    passWithNoTests: true,
  },
})
