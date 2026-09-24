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
 * ## Two writers, one shape
 *
 * - **A moderator's browser** — the live mirror (`src/collab/liveMirror.ts`)
 *   posts what changed a few seconds after it changes, deletions included.
 * - **The daily cron** reads the live document itself, from the server
 *   (`api/_lib/liveDocument.ts`), and writes what the copy lacks or has out of
 *   date — so the playground's edits are copied even when no moderator is
 *   online. It never deletes, and every run is recorded in `backup_runs`, where
 *   `/manage` reads whether the last one worked.
 *
 * ## Partial snapshots do not delete — unless they say exactly what to
 *
 * Posted pages are upserted, and a page is never deleted just because a post
 * left it out: a client that has synced only part of the document must not be
 * able to erase the rest of the backup by posting what it happens to have.
 *
 * The live mirror (`src/collab/liveMirror.ts`) does need to delete — a page
 * removed from the service must leave the backup too, or it lives on in the
 * fallback — so it names deletions explicitly: `removed` (whole pages) and
 * `truncate` (screens past a carousel's new length). Only a signed-in moderator
 * may send either, and the mirror holds back any batch of deletions that looks
 * like a broken document rather than an edit.
 *
 * ## Three reads
 *
 * - `GET` — how many pages the backup holds and when it last changed (the
 *   cron's health check).
 * - `GET ?index` — every row's fingerprint, so the mirror can send only what
 *   changed. Moderator only.
 * - `GET ?boot` — the pages as visitors see them while playhtml is still
 *   loading. Public, compressed, and cached at the edge for a minute, so the
 *   fallback is at most about a minute behind rather than as old as the last
 *   deploy. See `src/domain/bootData.ts`.
 */

import { gzipSync } from 'node:zlib';

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { bootPage, type BootData } from '../src/domain/bootData';
import { toInteger } from '../src/domain/coerce';
import { DEFAULT_PAGE_KIND, isPageKind } from '../src/domain/directory';
import { isCompletePageArray, pageToArray } from '../src/domain/pageEncoding';
import {
  MAX_SUBPAGE,
  MIN_SUBPAGE,
  pageKey,
  parsePageKey,
  subpageCountOf,
} from '../src/domain/subpages';
import { liveScreens, planMirror } from '../src/domain/liveMirror';
import { SITE_URL } from '../src/domain/seo';
import { db, transaction } from './_lib/db';
import { LiveDocumentError, readLiveDocument, type LiveDocumentRead } from './_lib/liveDocument';
import { bodyObject, fail, json, methodIs, queryValue, serverError } from './_lib/http';
import { isAdmin, isVercelCron } from './_lib/auth';

/** Page numbers the playground occupies, below `MIN_PAGE`, are still backed up. */
const MIN_SNAPSHOT_PAGE = 1;
const MAX_SNAPSHOT_PAGE = 999;

function inSnapshotRange(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SNAPSHOT_PAGE && n <= MAX_SNAPSHOT_PAGE;
}

interface Accepted {
  pageNumber: number;
  /** Which screen of the page's carousel this row is; 1 is the page itself. */
  subpage: number;
  /** How many screens the page holds, repeated on each of its rows. */
  subpageCount: number;
  cells: unknown;
  title: string;
  kind: string;
  description: string;
  /** The mirror's fingerprint of this row, or null from the manual backup. */
  digest: string | null;
  /** Where the screen came from (`page-sources`), or null for one made by hand. */
  source: string | null;
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
    // Checked against the domain's own list, so adding a heading level does not
    // silently start flattening it here.
    return isPageKind(value) ? value : DEFAULT_PAGE_KIND;
  };

  const descriptions = body.descriptions;
  const descriptionFor = (pageNumber: number): string => {
    if (descriptions == null || typeof descriptions !== 'object') return '';
    const value = (descriptions as Record<string, unknown>)[pageNumber];
    return typeof value === 'string' ? value.slice(0, 500) : '';
  };

  // How many screens each page holds. Read from the client's own map rather
  // than counted from the keys present: playhtml cannot delete a key, so a
  // removed subpage leaves a blank one behind and counting would over-report.
  const counts = body.subpageCounts;
  const countFor = (pageNumber: number): number =>
    counts != null && typeof counts === 'object'
      ? subpageCountOf(counts as Record<number, number>, pageNumber)
      : MIN_SUBPAGE;

  const digests = body.digests;
  const digestFor = (key: string): string | null => {
    if (digests == null || typeof digests !== 'object') return null;
    const value = (digests as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length <= 64 ? value : null;
  };

  const sources = body.sources;
  const sourceFor = (key: string): string | null => {
    if (sources == null || typeof sources !== 'object') return null;
    const value = (sources as Record<string, unknown>)[key];
    // Stored as given, but only an object of plausible size: this is a copy of
    // what playhtml holds, not something the backup interprets.
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = JSON.stringify(value);
    return text.length <= 4096 ? text : null;
  };

  const accepted: Accepted[] = [];
  let rejected = 0;

  for (const [key, stored] of Object.entries(pages as Record<string, unknown>)) {
    // A key is either a page number or `"220.2"` for a subpage of one. Anything
    // else is rejected rather than guessed at — the backup is the copy of
    // record, and a key nobody can read is a page nobody can restore.
    const parsed = parsePageKey(key);
    if (parsed == null || !inSnapshotRange(parsed.pageNumber)) {
      rejected += 1;
      continue;
    }
    const { pageNumber, subpage } = parsed;
    // playhtml holds an index-keyed map; convert, then insist the result is a
    // page that was actually there rather than one conjured out of nothing.
    const cells = pageToArray(stored);
    if (!isCompletePageArray(cells)) {
      rejected += 1;
      continue;
    }
    accepted.push({
      pageNumber,
      subpage,
      subpageCount: countFor(pageNumber),
      cells,
      // Title, directory role and description belong to the page, not to one of
      // its screens: a carousel is one entry in the Yellow Pages. Every row of
      // a page therefore carries the same three, and a restore reads them off
      // whichever row it likes.
      title: titleFor(pageNumber),
      kind: kindFor(pageNumber),
      description: descriptionFor(pageNumber),
      digest: digestFor(key),
      source: sourceFor(key),
    });
  }

  return { accepted, rejected };
}

/** Most pages one request may delete: the mirror never needs more. */
const MAX_REMOVALS = 200;

/**
 * The deletions a post names, checked. Anything malformed is dropped rather
 * than guessed at — a deletion is the one write a backup cannot undo.
 */
function deletions(body: Record<string, unknown>): {
  removed: number[];
  truncate: { pageNumber: number; count: number }[];
} {
  const removed = (Array.isArray(body.removed) ? body.removed : [])
    .map((value) => toInteger(value))
    .filter((n): n is number => n != null && inSnapshotRange(n))
    .slice(0, MAX_REMOVALS);
  const truncate = (Array.isArray(body.truncate) ? body.truncate : [])
    .map((item) => {
      const entry = (item ?? {}) as { pageNumber?: unknown; count?: unknown };
      return { pageNumber: toInteger(entry.pageNumber), count: toInteger(entry.count) };
    })
    .filter(
      (entry): entry is { pageNumber: number; count: number } =>
        entry.pageNumber != null &&
        inSnapshotRange(entry.pageNumber) &&
        entry.count != null &&
        entry.count >= MIN_SUBPAGE &&
        entry.count <= MAX_SUBPAGE,
    )
    .slice(0, MAX_REMOVALS);
  return { removed, truncate };
}

/** The pages file visitors draw from until playhtml syncs, from the backup. */
async function bootData(): Promise<BootData> {
  const rows = await db()`
    select page_number, subpage, subpage_count, title, kind, cells
    from live_pages
    order by page_number, subpage
  `;
  const data: BootData = { pages: {}, 'subpage-counts': {}, titles: {}, 'page-kinds': {} };
  for (const row of rows) {
    const pageNumber = Number(row.page_number);
    const subpage = Number(row.subpage);
    data.pages[String(pageKey(pageNumber, subpage))] = bootPage(row.cells);
    const count = Number(row.subpage_count ?? subpage);
    data['subpage-counts'][pageNumber] = Math.max(data['subpage-counts'][pageNumber] ?? 1, count);
    if (subpage === MIN_SUBPAGE) {
      if (typeof row.title === 'string' && row.title !== '') data.titles[pageNumber] = row.title;
      if (isPageKind(row.kind)) data['page-kinds'][pageNumber] = row.kind;
    }
  }
  return data;
}

/**
 * Write rows and the deletions a post names, in one transaction: they land
 * together or not at all. Arrays are unnested rather than building a giant
 * VALUES list, so the statement stays the same size however many pages.
 */
async function writeRows(
  accepted: readonly Accepted[],
  removed: readonly number[] = [],
  truncate: readonly { pageNumber: number; count: number }[] = [],
): Promise<void> {
  const numbers = accepted.map((page) => page.pageNumber);
  const subpages = accepted.map((page) => page.subpage);
  const subpageCounts = accepted.map((page) => page.subpageCount);
  const cells = accepted.map((page) => JSON.stringify(page.cells));
  const titles = accepted.map((page) => page.title);
  const kindValues = accepted.map((page) => page.kind);
  const descriptionValues = accepted.map((page) => page.description);
  const digestValues = accepted.map((page) => page.digest);
  const sourceValues = accepted.map((page) => page.source);

  await transaction((sql) => {
    const statements = [];
    if (accepted.length > 0) {
      statements.push(sql`
        insert into live_pages
          (page_number, subpage, subpage_count, cells, title, kind, description, digest, source, updated_at)
        select * from unnest(
          ${numbers}::int[],
          ${subpages}::int[],
          ${subpageCounts}::int[],
          ${cells}::jsonb[],
          ${titles}::text[],
          ${kindValues}::text[],
          ${descriptionValues}::text[],
          ${digestValues}::text[],
          ${sourceValues}::jsonb[]
        ) as t(page_number, subpage, subpage_count, cells, title, kind, description, digest, source),
          lateral (select now()) as u(updated_at)
        on conflict (page_number, subpage) do update
          set cells = excluded.cells,
              subpage_count = excluded.subpage_count,
              title = excluded.title,
              kind = excluded.kind,
              description = excluded.description,
              digest = excluded.digest,
              source = excluded.source,
              updated_at = excluded.updated_at
      `);
    }
    if (truncate.length > 0) {
      statements.push(sql`
        delete from live_pages l
        using unnest(
          ${truncate.map((t) => t.pageNumber)}::int[],
          ${truncate.map((t) => t.count)}::int[]
        ) as t(page_number, keep)
        where l.page_number = t.page_number and l.subpage > t.keep
      `);
    }
    if (removed.length > 0) {
      statements.push(sql`delete from live_pages where page_number = any(${[...removed]}::int[])`);
    }
    return statements;
  });
}

/** Pages per statement in the daily job: a page's cells are ~60 KB of JSON. */
const DAILY_CHUNK = 25;

export interface DailyOutcome {
  ok: boolean;
  stored: number;
  lingering: number;
  bytes: number | null;
  ms: number | null;
  detail: string | null;
}

/**
 * The daily job: read the live document from the server and write what the
 * copy lacks or has out of date. Never deletes — a page missing from what was
 * read could be a partial read as easily as a deletion, and deletions are left
 * to the moderator mirror, which holds large ones for a person to confirm.
 *
 * Fingerprinted exactly as the mirror does (`liveScreens`), so what this
 * writes is not sent again by the next moderator browser.
 */
async function dailyRead(
  read: (siteHost: string) => Promise<LiveDocumentRead> = (siteHost) => readLiveDocument({ siteHost }),
): Promise<DailyOutcome> {
  const { channels, bytes, ms } = await read(new URL(SITE_URL).hostname);
  const screens = liveScreens(channels);
  const index = await db()`select page_number, subpage, digest from live_pages`;
  const copy = new Map(
    index.map((row) => [`${row.page_number}.${row.subpage}`, (row.digest as string | null) ?? null]),
  );
  const plan = planMirror(screens, copy, { maxRemovals: 0 });

  let stored = 0;
  for (let at = 0; at < plan.upserts.length; at += DAILY_CHUNK) {
    const keys = plan.upserts.slice(at, at + DAILY_CHUNK).map((key) => {
      const [page, screen] = key.split('.').map(Number);
      return { key, stored: String(pageKey(page, screen)) };
    });
    const body = {
      pages: Object.fromEntries(keys.map(({ stored: k }) => [k, channels.pages[k] ?? {}])),
      titles: channels.titles,
      kinds: channels.kinds,
      descriptions: channels.descriptions,
      subpageCounts: channels.counts,
      digests: Object.fromEntries(keys.map(({ key, stored: k }) => [k, screens.get(key)?.digest ?? null])),
      sources: Object.fromEntries(keys.map(({ stored: k }) => [k, channels.sources?.[k] ?? null])),
    };
    const { accepted } = acceptable(body);
    await writeRows(accepted);
    stored += accepted.length;
  }

  return {
    ok: true,
    stored,
    lingering: plan.removed.length + plan.held.length,
    bytes,
    ms,
    detail: null,
  };
}

async function recordRun(outcome: DailyOutcome): Promise<void> {
  await db()`
    insert into backup_runs (ok, stored, lingering, bytes, ms, detail)
    values (${outcome.ok}, ${outcome.stored}, ${outcome.lingering}, ${outcome.bytes},
            ${outcome.ms}, ${outcome.detail})
  `;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'POST', 'GET')) return;

  // The fallback is public: it is the same pages the site shows anyone.
  if (req.method === 'GET' && queryValue(req, 'boot') != null) {
    try {
      // Compressed here rather than left to the platform: uncompressed, a few
      // hundred pages pass the 4.5 MB a function may return, and they shrink
      // about sixteenfold.
      const body = gzipSync(JSON.stringify(await bootData()));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      // At most a minute old at the edge; a stale copy is served while it
      // refreshes, since any fallback beats a blank screen.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
      res.status(200).send(body);
    } catch (error) {
      serverError(res, 'snapshot/boot', error);
    }
    return;
  }

  const authorized = isAdmin(req) || isVercelCron(req);
  if (!authorized) {
    fail(res, 401, 'Sign in to snapshot.');
    return;
  }

  try {
    // A GET (or an empty cron POST) reports the state of the backup without
    // changing it.
    if (req.method === 'GET' && queryValue(req, 'index') != null) {
      if (!isAdmin(req)) {
        fail(res, 401, 'Sign in to read the backup index.');
        return;
      }
      const rows = await db()`
        select page_number, subpage, digest from live_pages
      `;
      res.setHeader('Cache-Control', 'no-store');
      json(res, 200, {
        rows: rows.map((row) => [Number(row.page_number), Number(row.subpage), row.digest ?? null]),
      });
      return;
    }

    // The daily cron: read the live document and copy what changed.
    if (req.method === 'GET' && isVercelCron(req)) {
      let outcome: DailyOutcome;
      try {
        outcome = await dailyRead();
      } catch (error) {
        outcome = {
          ok: false,
          stored: 0,
          lingering: 0,
          bytes: null,
          ms: null,
          detail:
            error instanceof LiveDocumentError
              ? `${error.reason}: ${error.message}`
              : error instanceof Error
                ? error.message
                : 'The daily read failed.',
        };
      }
      await recordRun(outcome);
      // A failure answers 500, so it shows as a failed run in Vercel's cron log
      // as well as in /manage.
      json(res, outcome.ok ? 200 : 500, outcome);
      return;
    }

    if (req.method === 'GET') {
      const rows = await db()`
        select count(*)::int as pages, max(updated_at) as latest from live_pages
      `;
      const runs = await db()`
        select ran_at, ok, stored, lingering, detail from backup_runs
        order by ran_at desc limit 1
      `;
      res.setHeader('Cache-Control', 'no-store');
      json(res, 200, {
        pages: rows[0]?.pages ?? 0,
        latest: rows[0]?.latest ?? null,
        daily: runs[0] ?? null,
      });
      return;
    }

    const body = bodyObject(req);
    const { accepted, rejected } = acceptable(body);
    // Deletions only from a signed-in moderator's mirror; the cron sends none.
    const { removed, truncate } = isAdmin(req) ? deletions(body) : { removed: [], truncate: [] };

    if (accepted.length === 0 && removed.length === 0 && truncate.length === 0) {
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

    await writeRows(accepted, removed, truncate);

    json(res, 200, {
      stored: accepted.length,
      rejected,
      removed: removed.length,
      truncated: truncate.length,
    });
  } catch (error) {
    serverError(res, 'snapshot', error);
  }
}

export { acceptable, dailyRead, inSnapshotRange };
