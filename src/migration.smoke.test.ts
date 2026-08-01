// Feature: collaborative-teletext-rooms, then archive-database.
// Migration smoke / static tests.
//
// These once asserted that no `api/` directory and no `@vercel/node` dependency
// existed at all. That was the right shape for the original migration, which
// moved page persistence off a Redis-backed serverless layer and onto playhtml —
// there, "no API" was a convenient proxy for "the server is not in the editing
// path".
//
// It is the wrong shape now. The archive-database feature deliberately adds a
// serverless layer back, for things a CRDT cannot do: holding thousands of
// archive captures nobody is currently editing, recording which capture is
// published where, authenticating an admin, and keeping a durable backup.
//
// So these tests assert the invariant the old ones were standing in for, which
// has not changed and is the one that actually matters:
//
//   Live page content and cell edits go through playhtml's CRDT, never through
//   an HTTP request/response cycle.
//
// That is why Redis failed. It stored a page as a value, so two people editing
// at once meant one whole-page write landing on top of the other. Reintroducing
// a request/response round trip into the *editing* path would reintroduce that
// bug, whatever the storage behind it.
//
// _Requirements: 7.5, 7.6_

import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = process.cwd()
const SRC_DIR = join(REPO_ROOT, 'src')

// Matches an actual fetch call to the API, e.g. fetch('/api/pages').
const FETCH_API_RE = /fetch\(\s*['"`]\/api/

/**
 * The modules that carry live page state. Editing, page display and the guide
 * all read and write through these, and every one of them must resolve
 * concurrent writes via Yjs rather than by asking a server.
 */
const LIVE_STATE_MODULES = [
  'collab/useEditPage.ts',
  'collab/useRoomSync.ts',
  'collab/useGuide.ts',
  'collab/useImportPages.ts',
  'collab/useSoloView.ts',
  'collab/useVoting.ts',
  'collab/useChat.ts',
  'collab/usePresence.ts',
]

// Test/spec files are excluded so this file's own assertions (which contain the
// literal patterns being searched for) don't produce false positives.
function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(path)
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !isTestFile(entry.name)) {
      files.push(full)
    }
  }
  return files
}

describe('live editing stays on the CRDT (Req 7.5, 7.6)', () => {
  it('keeps every live-page module free of server round trips', async () => {
    const offenders: string[] = []

    for (const relativePath of LIVE_STATE_MODULES) {
      const content = await readFile(join(SRC_DIR, relativePath), 'utf8')
      if (FETCH_API_RE.test(content)) offenders.push(relativePath)
    }

    expect(
      offenders,
      `These carry live page state and must not fetch from the server — a ` +
        `request/response write is what made concurrent edits clobber each ` +
        `other under Redis: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('does not bring back the page-persistence endpoints', async () => {
    // The specific endpoints the Redis layer used. The current API deals in
    // archive captures, publication records, backups and auth — never in
    // reading or writing the live page a visitor is looking at.
    const files = await collectSourceFiles(SRC_DIR)
    const offenders: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (content.includes('/api/pages') || content.includes('/api/titles')) {
        offenders.push(relative(REPO_ROOT, file).split(sep).join('/'))
      }
    }

    expect(
      offenders,
      `Found page-persistence API usage in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('has no redis dependency', async () => {
    const raw = await readFile(join(REPO_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    expect(allDeps).not.toHaveProperty('redis')
  })

  it('keeps @vercel/node out of the shipped bundle', async () => {
    // It is back, but as a devDependency: it provides request/response types
    // for the serverless routes and must never be pulled into what visitors
    // download.
    const raw = await readFile(join(REPO_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(pkg.dependencies ?? {}).not.toHaveProperty('@vercel/node')
    expect(pkg.devDependencies ?? {}).toHaveProperty('@vercel/node')
  })

  it('never imports server-only modules from client source', async () => {
    // `api/_lib/*` reads DATABASE_URL, ADMIN_PASSWORD and SESSION_SECRET. A
    // client import would be a route to leaking them into the bundle — the
    // exact failure VITE_MODERATOR_PASSCODE represented.
    const files = await collectSourceFiles(SRC_DIR)
    const offenders: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (/from\s+['"][^'"]*api\/_lib/.test(content)) {
        offenders.push(relative(REPO_ROOT, file).split(sep).join('/'))
      }
    }

    expect(
      offenders,
      `Client source must not import server-only modules: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('keeps secrets out of anything VITE_ would inline', async () => {
    // Only VITE_-prefixed variables reach the browser. The admin password must
    // never be one again.
    //
    // Matches the *read* (`import.meta.env.VITE_…`) rather than the bare name,
    // so that prose explaining why the old passcode was a mistake does not
    // register as making it again.
    const SECRET_ENV_READ =
      /import\.meta\.env\.VITE_[A-Z0-9_]*(PASSCODE|PASSWORD|SECRET|TOKEN|KEY)/
    const files = await collectSourceFiles(SRC_DIR)
    const offenders: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (SECRET_ENV_READ.test(content)) {
        offenders.push(relative(REPO_ROOT, file).split(sep).join('/'))
      }
    }

    expect(
      offenders,
      `A VITE_-prefixed secret is inlined into the client bundle in: ${offenders.join(', ')}`,
    ).toEqual([])
  })
})
