/**
 * `GET /api/captures` — browse the corpus.
 *
 * This is the selection surface. Page numbers were reused for unrelated content
 * over the years, so a number is not a version key and the ~4 captures sharing
 * one are usually different pages entirely. Choosing between them is a
 * curatorial act, and the filters here are the ones that support it: topic (the
 * on-disk folder division), era, source, and page number.
 *
 * ## Cells are never in the list
 *
 * A page's cells are ~59 KB. Returning them for a page of results would be tens
 * of megabytes to render thumbnails nobody asked for. The list carries metadata
 * only; `GET /api/captures/[id]` fetches one capture's cells when something is
 * actually being previewed.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { db } from '../_lib/db';
import { isAdmin } from '../_lib/auth';
import {
  fail,
  json,
  methodIs,
  queryInt,
  queryValue,
  serverError,
} from '../_lib/http';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  if (!isAdmin(req)) {
    fail(res, 401, 'Sign in to browse the archive.');
    return;
  }

  try {
    const source = queryValue(req, 'source');
    const topic = queryValue(req, 'topic');
    const topicGroup = queryValue(req, 'topicGroup');
    const scheme = queryValue(req, 'scheme');
    const search = queryValue(req, 'q');
    const page = queryInt(req, 'page', 0, 1, 999);
    const limit = queryInt(req, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = queryInt(req, 'offset', 0, 0, 100_000);
    // Undecoded captures are hidden by default — they cannot be published — but
    // remain reachable, since they are most of the SIC corpus and still worth
    // browsing while support for them is pending.
    const includeUndecoded = queryValue(req, 'undecoded') === 'true';

    // `is null` guards make each filter optional in a single prepared
    // statement, rather than concatenating SQL per request.
    const rows = await db()`
      select
        id, source, original_page, sub, sub_index, topic, topic_group,
        topic_source, scheme, first_seen, last_seen, capture_count,
        tier, bucket, manifest_title, decode_status, profile,
        width, height, snapped_pixels, unknown_glyphs, corpus_file
      from archive_captures
      where (${source ?? null}::text is null or source = ${source ?? null})
        and (${topic ?? null}::text is null or topic = ${topic ?? null})
        and (${topicGroup ?? null}::text is null or topic_group = ${topicGroup ?? null})
        and (${scheme ?? null}::text is null or scheme = ${scheme ?? null})
        and (${page === 0 ? null : page}::int is null
             or original_page = ${page === 0 ? null : page})
        and (${search ?? null}::text is null
             or manifest_title ilike '%' || ${search ?? null} || '%'
             or corpus_file ilike '%' || ${search ?? null} || '%')
        and (${includeUndecoded} or decode_status = 'ok')
      order by original_page, sub_index nulls last, first_seen
      limit ${limit} offset ${offset}
    `;

    const totals = await db()`
      select count(*)::int as total
      from archive_captures
      where (${source ?? null}::text is null or source = ${source ?? null})
        and (${topic ?? null}::text is null or topic = ${topic ?? null})
        and (${topicGroup ?? null}::text is null or topic_group = ${topicGroup ?? null})
        and (${scheme ?? null}::text is null or scheme = ${scheme ?? null})
        and (${page === 0 ? null : page}::int is null
             or original_page = ${page === 0 ? null : page})
        and (${search ?? null}::text is null
             or manifest_title ilike '%' || ${search ?? null} || '%'
             or corpus_file ilike '%' || ${search ?? null} || '%')
        and (${includeUndecoded} or decode_status = 'ok')
    `;

    json(res, 200, {
      captures: rows,
      total: totals[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    serverError(res, 'captures/index', error);
  }
}
