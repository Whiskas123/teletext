/**
 * Whether a save from /manage was made from an out-of-date copy of the archive.
 *
 * Each /manage tab edits its own copy of the curated pages, read once when it
 * loads (`collab/archiveStore.ts`), and saves the screens that changed in that
 * copy. Nothing tells a tab that another one moved pages since: on 2026-11-14 a
 * tab still showing the old order saved two edited headings onto the numbers
 * another tab had just given to other pages, and those pages were lost.
 *
 * So a save names, for each screen it writes or deletes, the fingerprint it
 * believes is stored (`expect`, keyed "page.screen"; null for "no such screen").
 * A screen is stale when what is stored is neither that nor what is being
 * written now (a retried save that already landed). A deletion is also stale
 * when the range it removes holds a screen the tab never knew of.
 */

export interface StoredScreen {
  pageNumber: number;
  subpage: number;
  digest: string | null;
}

/** The "page.screen" keys that changed under the tab, sorted; empty when the save may go ahead. */
export function staleScreens(
  expect: ReadonlyMap<string, string | null>,
  /** What this save writes: key to its new fingerprint. */
  writing: ReadonlyMap<string, string | null>,
  /** Whether this save deletes that screen (a removed page, or past a shortened carousel). */
  deleting: (pageNumber: number, subpage: number) => boolean,
  /** The stored screens of every page the save touches. */
  stored: readonly StoredScreen[],
): string[] {
  const now = new Map(stored.map((row) => [`${row.pageNumber}.${row.subpage}`, row.digest]));
  const stale = new Set<string>();

  for (const [key, expected] of expect) {
    const [page, screen] = key.split('.').map(Number);
    if (!now.has(key)) {
      // Gone, though the tab believed it was there: fine only if it is being deleted anyway.
      if (expected !== null && !deleting(page, screen)) stale.add(key);
      continue;
    }
    const current = now.get(key) ?? null;
    if (current !== expected && !(writing.has(key) && current === writing.get(key))) stale.add(key);
  }
  for (const row of stored) {
    const key = `${row.pageNumber}.${row.subpage}`;
    if (deleting(row.pageNumber, row.subpage) && !expect.has(key)) stale.add(key);
  }
  return [...stale].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
}
