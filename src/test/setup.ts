// Global test setup for Vitest.
//
// This file runs once before the test suite in every test file (configured via
// `setupFiles` in vitest.config.ts).
//
// - `@testing-library/jest-dom` registers custom DOM matchers (e.g.
//   `toBeInTheDocument`, `toHaveTextContent`) on Vitest's `expect`.
// - `cleanup` unmounts React trees rendered by `@testing-library/react` after
//   each test so component tests remain isolated.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
