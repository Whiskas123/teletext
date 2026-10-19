/**
 * Which store a page's content lives in, decided by its number alone.
 *
 * The curated archive (100..699, `access.ts`) lives in the database: only a
 * moderator edits it, and it is most of the site's content. Everything else —
 * the open playground — lives in playhtml, where visitors edit it together.
 * They used to share one playhtml document, which grew until playhtml's server
 * could no longer open it (October 2026); keeping the archive out of it keeps
 * the live document small.
 *
 * Every content channel is keyed by page — `"220"`, or `"220.2"` for a screen
 * of a carousel — so the same rule splits all of them. Pure and framework-free.
 */

import { isArchivePage } from './access';
import { parsePageKey } from './subpages';

/** Whether a channel key belongs to a curated archive page. */
export function isArchiveKey(key: string | number): boolean {
  const parsed = parsePageKey(key);
  return parsed != null && isArchivePage(parsed.pageNumber);
}

/** The entries of `record` that belong to one store. */
export function pickStore<T>(
  record: Readonly<Record<string, T>> | undefined,
  archive: boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (isArchiveKey(key) === archive) out[key] = value;
  }
  return out;
}

/**
 * What a write changed, split by store.
 *
 * Compared by identity, key by key: a write is computed on a shallow copy of
 * the merged view and replaces whole entries, so an entry it touched is a new
 * value and one it left alone is the same object. Only the changed keys are
 * sent — to the database for archive pages, to playhtml for the rest.
 */
export function splitChanges<T>(
  before: Readonly<Record<string, T>>,
  after: Readonly<Record<string, T>>,
): { archive: Record<string, T>; live: Record<string, T> } {
  const archive: Record<string, T> = {};
  const live: Record<string, T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    // A key the write removed is sent as its empty value by the caller's own
    // rule; here it is simply absent from `after`.
    (isArchiveKey(key) ? archive : live)[key] = after[key];
  }
  return { archive, live };
}
