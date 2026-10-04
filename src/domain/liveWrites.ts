/**
 * Splitting a large write to the live document into pieces small enough to
 * arrive.
 *
 * playhtml sends each transaction to its server as one WebSocket message, and
 * a message over the host's limit (about 1 MiB) never lands: the change shows
 * in the tab that made it and nowhere else, and is gone on reload. A screen is
 * roughly 100 KB once Yjs has encoded its 960 cells, so anything that rewrites
 * more than a handful of screens at once has to go out in pieces. Closing a
 * gap in front of 44 pages was one 4.9 MB transaction, and silently lost.
 *
 * The pieces are ordered so that what visitors can see in between is at worst
 * a page shown twice for a moment, never a page missing: every screen that
 * receives content is written first, and the screens it left are emptied last.
 *
 * Pure and framework-free.
 */

/**
 * Most JSON characters one write carries. Yjs encodes a screen at about 1.7×
 * its JSON length, so this keeps each message near 450 KB — well under the
 * limit, with room for the one entry that is larger than the rest.
 */
export const MAX_WRITE_JSON = 256 * 1024;

export type LiveEntry<T> = readonly [key: string, value: T];

/** A screen's empty value, as playhtml's draft stores it (it cannot delete keys). */
export function isEmptyValue(value: unknown): boolean {
  return value == null || (typeof value === 'object' && Object.keys(value).length === 0);
}

/**
 * Group entries into writes of at most `budget` JSON characters each. An entry
 * bigger than the budget gets a write of its own rather than being refused.
 */
export function chunkEntries<T>(entries: readonly LiveEntry<T>[], budget: number = MAX_WRITE_JSON): LiveEntry<T>[][] {
  const chunks: LiveEntry<T>[][] = [];
  let current: LiveEntry<T>[] = [];
  let size = 0;
  for (const entry of entries) {
    const weight = JSON.stringify(entry[1] ?? null).length + entry[0].length;
    if (current.length > 0 && size + weight > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += weight;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * The writes for a set of changed keys, in the order to send them: content
 * first, in pieces, then every emptied key together (empty values are tiny).
 */
export function orderedWrites<T>(entries: readonly LiveEntry<T>[], budget: number = MAX_WRITE_JSON): LiveEntry<T>[][] {
  const filled = entries.filter(([, value]) => !isEmptyValue(value));
  const emptied = entries.filter(([, value]) => isEmptyValue(value));
  const writes = chunkEntries(filled, budget);
  if (emptied.length > 0) writes.push(emptied);
  return writes;
}

/**
 * Which keys a replay actually changed, comparing its result with the live
 * values. A key rewritten with what it already held is left out: it would only
 * add weight to the writes.
 */
export function changedEntries<T>(
  result: Readonly<Record<string, T>>,
  live: Readonly<Record<string, unknown>> | undefined,
): LiveEntry<T>[] {
  const same = (a: unknown, b: unknown) =>
    (isEmptyValue(a) && isEmptyValue(b)) || JSON.stringify(a) === JSON.stringify(b);
  return Object.entries(result).filter(([key, value]) => !same(value, live?.[key]));
}
