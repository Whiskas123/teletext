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
 * - `GET ?sub=220` / `?sub=220.2` (public) — one screen's translation, for the
 *   EN key. Cached at the edge for a minute, like the boot pages.
 * - `GET ?subs` (moderator) — every translation, for /manage to show which
 *   pages have one and whether it still covers what the page says now.
 * - `POST ?translate` (moderator, body `{ pageNumber, subpage }`) — translate
 *   one screen of a curated page as it is in `live_pages` now, store it, and
 *   return it. Only 100–699: the playground changes too often to translate
 *   ahead of time, and its copy here is a backup that may lag.
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
import { db } from './db';
import { bodyObject, fail, json, queryValue, serverError } from './http';
import { isTranslationConfigured, TRANSLATION_MODEL, translateRuns } from './translate';

/** Under the function's 60 s, so a slow answer is a clear error and not a kill. */
const TRANSLATE_TIMEOUT_MS = 50_000;

/** Handle the request if it is one of these; `false` leaves it to the caller. */
export async function handleTranslations(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  if (req.method === 'GET' && queryValue(req, 'sub') != null) {
    await readOne(res, queryValue(req, 'sub') ?? '');
    return true;
  }
  if (req.method === 'GET' && queryValue(req, 'subs') != null) {
    if (!isAdmin(req)) fail(res, 401, 'Sign in to read the translations.');
    else await readAll(res);
    return true;
  }
  if (req.method === 'POST' && queryValue(req, 'translate') != null) {
    if (!isAdmin(req)) fail(res, 401, 'Sign in to translate pages.');
    else await translate(req, res);
    return true;
  }
  return false;
}

async function readOne(res: VercelResponse, key: string): Promise<void> {
  const parsed = parsePageKey(key);
  if (parsed == null) {
    fail(res, 400, 'Not a page.');
    return;
  }
  try {
    const rows = await db()`
      select runs from page_translations
      where page_number = ${parsed.pageNumber} and subpage = ${parsed.subpage}
    `;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    if (rows.length === 0) fail(res, 404, 'No translation.');
    else json(res, 200, { runs: rows[0].runs });
  } catch (error) {
    serverError(res, 'snapshot/sub', error);
  }
}

async function readAll(res: VercelResponse): Promise<void> {
  try {
    const rows = await db()`select page_number, subpage, runs from page_translations`;
    const translations: Record<string, SubtitleEntry[]> = {};
    for (const row of rows) translations[String(pageKey(row.page_number, row.subpage))] = row.runs;
    res.setHeader('Cache-Control', 'no-store');
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
