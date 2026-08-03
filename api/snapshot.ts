/**
 * `POST /api/snapshot` — store the current playhtml state in `live_pages`.
 *
 * This is the backup that makes collaborative edits survivable. playhtml keeps
 * the live document on PartyKit, which is a third-party service this project
 * does not control and has no export from; `live_pages` is the copy we own.
 *
 * Covers the full 1..999 range, not just the published archive. Pages 700..999
 * are the open playground (`src/domain/access.ts`) — visitors' own work, and the
 * content least reproducible from anywhere else.
 *
 * ## Two callers, one shape
 *
 * The browser posts `{ pages, titles }` read from the playhtml channels, because
 * only a connected client can see them — there is no server-side read of a Yjs
 * document here. A Vercel cron also hits this route on a schedule; with no body
 * it has nothing to store, so it answers with what the last snapshot holds
 * rather than wiping anything. The cron therefore serves as a liveness check on
 * the backup, and the browser button (or a page left open) does the real work.
 *
 * ## Partial snapshots do not delete
 *
 * Pages are upserted, never deleted. A client that has synced only part of the
 * document must not be able to erase the rest of the backup by posting what it
 * happens to have.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isCompletePageArray, pageToArray } from '../src/domain/pageEncoding';
import { db } from './_lib/db';
import { bodyObject, fail, json, methodIs, serverError } from './_lib/http';
import { isAdmin, isVercelCron } from './_lib/auth';

/** Page numbers the playground occupies, below `MIN_PAGE`, are still backed up. */
const MIN_SNAPSHOT_PAGE = 1;
const MAX_SNAPSHOT_PAGE = 999;

function inSnapshotRange(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SNAPSHOT_PAGE && n <= MAX_SNAPSHOT_PAGE;
}

interface Accepted {
  pageNumber: number;
  cells: unknown;
  title: string;
  kind: string;
  description: string;
}

/**
 * The pages worth storing out of a posted body.
 *
 * A page is skipped rather than repaired when its cells are not already a
 * complete, well-formed page: `normalizePage` would happily turn junk into a
 * blank page, and a blank page written over a good backup is worse than no
 * write at all.
 */
function acceptable(body: Record<string, unknown>): {
  accepted: Accepted[];
  rejected: number;
} {
  const pages = body.pages;
  const titles = body.titles;
  if (pages == null || typeof pages !== 'object') {
    return { accepted: [], rejected: 0 };
  }

  const titleFor = (pageNumber: number): string => {
    if (titles == null || typeof titles !== 'object') return '';
    const value = (titles as Record<string, unknown>)[pageNumber];
    return typeof value === 'string' ? value.slice(0, 60) : '';
  };

  // The page's role in the Yellow Pages directory. Anything unrecognised is
  // stored as an ordinary page rather than rejected: a bad kind should cost the
  // directory a heading, not cost the backup a page.
  const kinds = body.kinds;
  const kindFor = (pageNumber: number): string => {
    if (kinds == null || typeof kinds !== 'object') return 'page';
    const value = (kinds as Record<string, unknown>)[pageNumber];
    return value === 'category' || value === 'subcategory' ? value : 'page';
  };

  const descriptions = body.descriptions;
  const descriptionFor = (pageNumber: number): string => {
    if (descriptions == null || typeof descriptions !== 'object') return '';
    const value = (descriptions as Record<string, unknown>)[pageNumber];
    return typeof value === 'string' ? value.slice(0, 500) : '';
  };

  const accepted: Accepted[] = [];
  let rejected = 0;

  for (const [key, stored] of Object.entries(pages as Record<string, unknown>)) {
    const pageNumber = Number(key);
    if (!inSnapshotRange(pageNumber)) {
      rejected += 1;
      continue;
    }
    // playhtml holds an index-keyed map; convert, then insist the result is a
    // page that was actually there rather than one conjured out of nothing.
    const cells = pageToArray(stored);
    if (!isCompletePageArray(cells)) {
      rejected += 1;
      continue;
    }
    accepted.push({
      pageNumber,
      cells,
      title: titleFor(pageNumber),
      kind: kindFor(pageNumber),
      description: descriptionFor(pageNumber),
    });
  }

  return { accepted, rejected };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'POST', 'GET')) return;

  const authorized = isAdmin(req) || isVercelCron(req);
  if (!authorized) {
    fail(res, 401, 'Sign in to snapshot.');
    return;
  }

  try {
    // A GET (or an empty cron POST) reports the state of the backup without
    // changing it.
    if (req.method === 'GET') {
      const rows = await db()`
        select count(*)::int as pages, max(updated_at) as latest from live_pages
      `;
      json(res, 200, {
        pages: rows[0]?.pages ?? 0,
        latest: rows[0]?.latest ?? null,
      });
      return;
    }

    const { accepted, rejected } = acceptable(bodyObject(req));

    if (accepted.length === 0) {
      const rows = await db()`
        select count(*)::int as pages, max(updated_at) as latest from live_pages
      `;
      json(res, 200, {
        stored: 0,
        rejected,
        pages: rows[0]?.pages ?? 0,
        latest: rows[0]?.latest ?? null,
        note: 'Nothing to store; existing snapshot left untouched.',
      });
      return;
    }

    // One statement for the whole batch: a snapshot is a single moment, and
    // upserting page by page would leave a half-written backup if it failed
    // part-way. Arrays are unnested rather than building a giant VALUES list so
    // the statement size stays constant regardless of page count.
    const numbers = accepted.map((page) => page.pageNumber);
    const cells = accepted.map((page) => JSON.stringify(page.cells));
    const titles = accepted.map((page) => page.title);
    const kindValues = accepted.map((page) => page.kind);
    const descriptionValues = accepted.map((page) => page.description);

    await db()`
      insert into live_pages (page_number, cells, title, kind, description, updated_at)
      select * from unnest(
        ${numbers}::int[],
        ${cells}::jsonb[],
        ${titles}::text[],
        ${kindValues}::text[],
        ${descriptionValues}::text[]
      ) as t(page_number, cells, title, kind, description),
        lateral (select now()) as u(updated_at)
      on conflict (page_number) do update
        set cells = excluded.cells,
            title = excluded.title,
            kind = excluded.kind,
            description = excluded.description,
            updated_at = excluded.updated_at
    `;

    json(res, 200, { stored: accepted.length, rejected });
  } catch (error) {
    serverError(res, 'snapshot', error);
  }
}

export { acceptable, inSnapshotRange };
