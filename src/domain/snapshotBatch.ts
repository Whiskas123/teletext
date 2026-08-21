/**
 * Splitting the live document into requests that will actually arrive.
 *
 * A Vercel serverless function refuses a request body over **4.5 MB**, and the
 * limit is not configurable. A teletext page is 960 cells and serialises to
 * roughly 68 KB, so the whole document crosses that at about 66 pages — and the
 * backup posted all of it in one request.
 *
 * That is not a hypothetical: it is why the backup silently stopped. Every
 * attempt after the document passed the limit answered `413`, the button showed
 * "Backup failed (413)", and `live_pages` kept whatever it had from the last
 * time the document was small enough. A backup that stops working as the thing
 * it protects grows is the worst shape a backup can have — it fails exactly
 * when there is most to lose.
 *
 * ## Why batching is safe here
 *
 * Because `api/snapshot.ts` was already written for it, whether or not that was
 * the intent: pages are **upserted and never deleted**, precisely so a client
 * that has synced only part of the document cannot wipe the rest of the backup
 * by posting what it happens to have. Several partial posts therefore compose
 * into one complete backup, and a run that dies half way leaves the pages it
 * managed rather than a corrupted snapshot.
 *
 * The one thing it costs is atomicity across batches: the backup is no longer a
 * single moment but a few seconds wide. For a copy of a document that is being
 * edited continuously anyway, that was never true in a meaningful sense.
 *
 * ## Why by size and not by count
 *
 * Pages are not the same size — a page of dense mosaic graphics carries a
 * colour per cell, while a mostly-blank one is a handful of keys. A fixed count
 * would have to be tuned for the worst case and would then send tiny requests
 * for the common one.
 */

/**
 * The budget for one request's `pages` map.
 *
 * Two thirds of Vercel's 4.5 MB, because the measurement below is of the pages
 * alone: the titles, kinds, descriptions and subpage counts ride along in every
 * request, and JSON escaping can inflate a string after it has been counted.
 * The margin is cheap — one extra request — and being wrong costs the backup.
 */
export const BATCH_BYTES = 3_000_000;

/**
 * Group `pages` into batches whose serialised size stays within `budget`.
 *
 * A page larger than the budget on its own still gets a batch of its own rather
 * than being dropped: the request may fail, but silently omitting a page from a
 * backup is worse than trying and being told. In practice no page comes close —
 * 960 cells cannot reach 3 MB.
 */
export function batchPages<T>(
  pages: Record<string, T>,
  budget: number = BATCH_BYTES,
): Record<string, T>[] {
  const batches: Record<string, T>[] = [];
  let current: Record<string, T> = {};
  let size = 0;

  for (const [key, value] of Object.entries(pages)) {
    // The cost of this entry in the request: the value, plus its key and the
    // punctuation around it. Approximate on purpose — an exact figure would
    // mean serialising the whole map twice.
    const entry = JSON.stringify(value).length + key.length + 4;

    if (size > 0 && size + entry > budget) {
      batches.push(current);
      current = {};
      size = 0;
    }

    current[key] = value;
    size += entry;
  }

  if (size > 0) batches.push(current);
  return batches;
}
