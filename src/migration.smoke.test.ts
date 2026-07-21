// Feature: collaborative-teletext-rooms
// Migration smoke / static tests.
// Verifies the persistence migration to playhtml is complete:
//  - No client source under src/ calls the removed /api layer (Req 7.5).
//  - The serverless api/ directory has been removed (Req 7.6).
//  - The redis / @vercel/node dependencies are gone from package.json (Req 7.6).
//
// _Requirements: 7.5, 7.6_

import { describe, it, expect } from 'vitest'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = process.cwd()
const SRC_DIR = join(REPO_ROOT, 'src')

// Matches an actual fetch call to the removed /api layer, e.g. fetch('/api/pages').
const FETCH_API_RE = /fetch\(\s*['"`]\/api/

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

describe('persistence migration to playhtml (Req 7.5, 7.6)', () => {
  it('has no client source under src/ that calls the removed /api layer', async () => {
    const files = await collectSourceFiles(SRC_DIR)
    const offenders: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (FETCH_API_RE.test(content) || content.includes('/api/pages')) {
        offenders.push(relative(REPO_ROOT, file).split(sep).join('/'))
      }
    }

    expect(offenders, `Found lingering /api usage in: ${offenders.join(', ')}`).toEqual([])
  })

  it('no longer contains the serverless api/ directory', async () => {
    await expect(access(join(REPO_ROOT, 'api'))).rejects.toBeDefined()
  })

  it('has no redis or @vercel/node dependency in package.json', async () => {
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
    expect(allDeps).not.toHaveProperty('@vercel/node')
  })
})
