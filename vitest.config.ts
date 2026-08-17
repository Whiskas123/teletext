/// <reference types="vitest/config" />
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
    setupFiles: ['./src/test/setup.ts'],
    // `api/` holds the serverless routes and their auth/session logic, which is
    // security-relevant and worth the same coverage as the domain modules.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'api/**/*.{test,spec}.ts'],
    // No tests exist yet during initial setup; don't fail the run.
    passWithNoTests: true,
  },
})
