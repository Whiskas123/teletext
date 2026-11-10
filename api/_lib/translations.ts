/**
 * English for curated pages — the `?sub`, `?subs` and `?translate` parts of
 * `/api/snapshot`.
 *
 * Here rather than in a function of their own because, when they were written,
 * `api/` was at the Hobby plan's cap of twelve functions. It has room now (see
 * `api/auth.ts`), but `snapshot` is still the right host: translations are made
 * from `live_pages`, and it already has the 60-second `maxDuration`
 * (`vercel.json`) that a call to Claude needs.
 *
 * - `GET ?sub=all` (public) — every translation, `{ translations: { "220.2":
 *   runs } }`, for the EN key: loaded once when a visitor first wants English,
 *   so each page change finds its English already there. Only curated pages
 *   are translated, so it stays small. Cached at the edge for a minute, like
 *   the boot pages.
 * - `GET ?subs` (moderator) — every translation, for /manage to show which
 *   pages have one and whether it still covers what the page says now.
 * - `POST ?translate` (moderator, body `{ pageNumber, subpage }`) — translate
 *   one screen of a curated page as it is in `live_pages` now, store it, and
 *   return it. Only 100–699: the playground changes too often to translate
 *   ahead of time, and its copy here is a backup that may lag.
 * - `POST ?sub=220.2` (moderator, body `{ runs: [{ row, col, en }] }`) — store
 *   English written or corrected by hand in /manage, replacing what the screen
 *   had. A run left out or left empty stays Portuguese.
 * - `POST ?subs-move` (moderator, body `{ moves: [{ from: "220.2", to: "221" }] }`)
 *   — carry translations along when /manage renumbers, merges, reorders or
 *   deletes screens; `to: null` drops one. Keyed by position, a translation
 *   left behind was claimed by whichever page moved into its number.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isArchivePage } from '../../src/domain/access';
import { toInteger } from '../../src/domain/coerce';
import { pageToArray } from '../../src/domain/pageEncoding';
import { MAX_SUBPAGE, MIN_SUBPAGE, pageKey, parsePageKey } from '../../src/domain/subpages';
import {
  applySubtitles,
  keepsNumbers,
  subtitleRuns,
  toEntries,
  type SubtitleEntry,
} from '../../src/domain/subtitles';
import { isAdmin } from './auth';
import { db, transaction } from './db';
import { bodyObject, fail, json, queryValue, serverError } from './http';
import { isTranslationConfigured, TRANSLATION_MODEL, translateRuns } from './translate';

/** Under the function's 60 s, so a slow answer is a clear error and not a kill. */
const TRANSLATE_TIMEOUT_MS = 50_000;

/** Handle the request if it is one of these; `false` leaves it to the caller. */
export async function handleTranslations(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  if (req.method === 'GET' && queryValue(req, 'sub') != null) {
    await readAll(res, 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    return true;
  }
  if (req.method === 'GET' && queryValue(req, 'subs') != null) {
    // The same list, uncached: /manage must see a save the moment it lands.
    if (!isAdmin(req)) fail(res, 401, 'Sign in to read the translations.');
    else await readAll(res, 'no-store');
    return true;
  }
  if (req.method === 'POST' && queryValue(req, 'translate') != null) {
    if (!isAdmin(req)) fail(res, 401, 'Sign in to translate pages.');
    else await translate(req, res);
    return true;
  }
  if (req.method === 'POST' && queryValue(req, 'subs-move') != null) {
    if (!isAdmin(req)) fail(res, 401, 'Sign in to move translations.');
    else await moveAll(req, res);
    return true;
  }
  if (req.method === 'POST' && queryValue(req, 'sub') != null) {
    if (!isAdmin(req)) fail(res, 401, 'Sign in to edit translations.');
    else await saveByHand(req, res, queryValue(req, 'sub') ?? '');
    return true;
  }
  return false;
}

/**
 * Store English edited by hand.
 *
 * The Portuguese each entry is matched against is read here, from the screen
 * as it is saved now, not taken from the request: an entry only applies while
 * the run still says what it said, so it has to be the server's copy of what
 * that was. Each line must fit its run, the same budget the EN key draws in.
 */
async function saveByHand(req: VercelRequest, res: VercelResponse, key: string): Promise<void> {
  const parsed = parsePageKey(key);
  if (parsed == null || !isArchivePage(parsed.pageNumber)) {
    fail(res, 400, 'Only curated pages (100–699) are translated.');
    return;
  }
  const { runs: raw } = bodyObject(req);
  const submitted: unknown[] = Array.isArray(raw) ? raw : [];
  try {
    const rows = await db()`
      select cells from live_pages where page_number = ${parsed.pageNumber} and subpage = ${parsed.subpage}
    `;
    if (rows.length === 0) {
      fail(res, 404, `Page ${parsed.pageNumber} screen ${parsed.subpage} is not saved yet.`);
      return;
    }
    const runs = subtitleRuns(pageToArray(rows[0].cells));
    const entries: SubtitleEntry[] = [];
    for (const item of submitted) {
      const { row, col, en } = (item ?? {}) as { row?: unknown; col?: unknown; en?: unknown };
      const run = runs.find((r) => r.row === row && r.start === col);
      const text = typeof en === 'string' ? en.trim() : '';
      if (run == null || text === '') continue;
      if (text.length > run.end - run.start) {
        fail(res, 400, `Row ${run.row + 1}: "${text}" is longer than its ${run.end - run.start} cells.`);
        return;
      }
      entries.push({ row: run.row, col: run.start, pt: run.text, en: text });
    }

    if (entries.length === 0) {
      await db()`delete from page_translations where page_number = ${parsed.pageNumber} and subpage = ${parsed.subpage}`;
    } else {
      await db()`
        insert into page_translations (page_number, subpage, runs, model, updated_at)
        values (${parsed.pageNumber}, ${parsed.subpage}, ${JSON.stringify(entries)}::jsonb, 'hand', now())
        on conflict (page_number, subpage)
        do update set runs = excluded.runs, model = excluded.model, updated_at = now()
      `;
    }
    const lost = entries.filter((entry) => !keepsNumbers(entry.pt, entry.en)).length;
    json(res, 200, { key: String(pageKey(parsed.pageNumber, parsed.subpage)), runs: entries, lost });
  } catch (error) {
    serverError(res, 'snapshot/sub', error);
  }
}

/** More than every screen of every curated page: a request past it is not /manage's. */
const MAX_MOVES = 600 * MAX_SUBPAGE;

/** A screen key as /manage sends it ("220", "220.2"), or null. */
function screenOf(raw: unknown): { pageNumber: number; subpage: number } | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  return parsePageKey(raw);
}

/**
 * Move translations from screen to screen, all in one transaction.
 *
 * Whatever is at a destination is dropped first: it belonged to the screen
 * that used to stand there, which has either moved too (and is carried in the
 * same request) or is gone. Done through a temporary copy, because the rows
 * being written are the ones being deleted.
 */
async function moveAll(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { moves: raw } = bodyObject(req);
  if (!Array.isArray(raw) || raw.length > MAX_MOVES) {
    fail(res, 400, 'Send the moves as a list.');
    return;
  }
  const fromPages: number[] = [];
  const fromSubs: number[] = [];
  const toPages: (number | null)[] = [];
  const toSubs: (number | null)[] = [];
  for (const item of raw) {
    const { from, to } = (item ?? {}) as { from?: unknown; to?: unknown };
    const source = screenOf(from);
    const target = to == null ? null : screenOf(to);
    if (source == null || (to != null && target == null)) {
      fail(res, 400, 'A move names a screen that does not exist.');
      return;
    }
    if (target != null && target.pageNumber === source.pageNumber && target.subpage === source.subpage) continue;
    fromPages.push(source.pageNumber);
    fromSubs.push(source.subpage);
    toPages.push(target?.pageNumber ?? null);
    toSubs.push(target?.subpage ?? null);
  }
  if (fromPages.length === 0) {
    json(res, 200, { moved: 0 });
    return;
  }

  try {
    await transaction((sql) => [
      sql`
        create temp table moving on commit drop as
        select p.tp as page_number, p.ts as subpage, t.runs, t.model, t.updated_at
        from unnest(${fromPages}::int[], ${fromSubs}::int[], ${toPages}::int[], ${toSubs}::int[]) as p(fp, fs, tp, ts)
        join page_translations t on t.page_number = p.fp and t.subpage = p.fs
        where p.tp is not null
      `,
      sql`
        delete from page_translations t
        using unnest(${fromPages}::int[], ${fromSubs}::int[], ${toPages}::int[], ${toSubs}::int[]) as p(fp, fs, tp, ts)
        where (t.page_number = p.fp and t.subpage = p.fs) or (t.page_number = p.tp and t.subpage = p.ts)
      `,
      sql`
        insert into page_translations (page_number, subpage, runs, model, updated_at)
        select page_number, subpage, runs, model, updated_at from moving
      `,
    ]);
    json(res, 200, { moved: fromPages.length });
  } catch (error) {
    serverError(res, 'snapshot/subs-move', error);
  }
}

async function readAll(res: VercelResponse, cacheControl: string): Promise<void> {
  try {
    const rows = await db()`select page_number, subpage, runs from page_translations`;
    const translations: Record<string, SubtitleEntry[]> = {};
    for (const row of rows) translations[String(pageKey(row.page_number, row.subpage))] = row.runs;
    res.setHeader('Cache-Control', cacheControl);
    json(res, 200, { translations });
  } catch (error) {
    serverError(res, 'snapshot/subs', error);
  }
}

async function translate(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = bodyObject(req);
  const pageNumber = toInteger(body.pageNumber);
  const subpage = toInteger(body.subpage) ?? MIN_SUBPAGE;
  if (pageNumber == null || !isArchivePage(pageNumber) || subpage < MIN_SUBPAGE || subpage > MAX_SUBPAGE) {
    fail(res, 400, 'Only curated pages (100–699) are translated.');
    return;
  }
  if (!isTranslationConfigured()) {
    fail(res, 503, 'Translation is not set up: ANTHROPIC_API_KEY is missing on the server.');
    return;
  }

  try {
    const rows = await db()`
      select cells from live_pages where page_number = ${pageNumber} and subpage = ${subpage}
    `;
    if (rows.length === 0) {
      fail(res, 404, `Page ${pageNumber} screen ${subpage} is not saved yet.`);
      return;
    }
    const page = pageToArray(rows[0].cells);
    const runs = subtitleRuns(page);
    if (runs.length === 0) {
      fail(res, 422, 'There is no text on this screen to translate.');
      return;
    }

    let english: string[];
    try {
      english = (await translateRuns(runs, { timeoutMs: TRANSLATE_TIMEOUT_MS })).english;
    } catch (error) {
      // Claude's answer, not the database's: safe to pass on, and the one thing
      // the moderator can act on (try again, or later).
      console.error('[snapshot/translate]', error);
      fail(res, 502, `Translation failed: ${error instanceof Error ? error.message : 'no answer'}.`);
      return;
    }

    const entries = toEntries(runs, english);
    await db()`
      insert into page_translations (page_number, subpage, runs, model, updated_at)
      values (${pageNumber}, ${subpage}, ${JSON.stringify(entries)}::jsonb, ${TRANSLATION_MODEL}, now())
      on conflict (page_number, subpage)
      do update set runs = excluded.runs, model = excluded.model, updated_at = now()
    `;
    const clipped = applySubtitles(page, runs, english).clipped.length;
    const lost = runs.filter((run, i) => !keepsNumbers(run.text, english[i])).length;
    json(res, 200, { key: String(pageKey(pageNumber, subpage)), runs: entries, clipped, lost });
  } catch (error) {
    serverError(res, 'snapshot/translate', error);
  }
}
