/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest configuration for the Teletext Workshop.
// - Pure domain logic (src/domain) is framework-free and runs fine under jsdom.
// - React component/integration tests (added later) require a DOM, so jsdom is
//   the default environment.
// Run via `bun run test` (single-run) or `bun run test:watch`.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // No tests exist yet during initial setup; don't fail the run.
    passWithNoTests: true,
  },
})
