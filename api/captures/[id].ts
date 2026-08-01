/**
 * `GET /api/captures/[id]` — one capture, cells included, for previewing.
 *
 * Separate from the list route precisely because of the cells: ~59 KB each,
 * fine for the one page being looked at, ruinous for sixty rows of results.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { pageToArray } from '../../src/domain/pageEncoding';
import { db } from '../_lib/db';
import { isAdmin } from '../_lib/auth';
import { fail, json, methodIs, queryValue, serverError } from '../_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  if (!isAdmin(req)) {
    fail(res, 401, 'Sign in to browse the archive.');
    return;
  }

  const id = Number(queryValue(req, 'id'));
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'Capture id must be a positive integer.');
    return;
  }

  try {
    const rows = await db()`
      select
        id, source, original_page, sub, sub_index, topic, topic_group,
        topic_source, topic_decided_by, scheme, first_seen, last_seen,
        capture_count, tier, bucket, manifest_title, decode_status,
        decode_detail, profile, width, height, snapped_pixels, unknown_glyphs,
        corpus_file, source_file, source_url, cells
      from archive_captures
      where id = ${id}
    `;

    const capture = rows[0];
    if (capture == null) {
      fail(res, 404, 'No such capture.');
      return;
    }

    json(res, 200, {
      ...capture,
      // Repaired on the way out rather than trusted: `normalizePage` is the one
      // definition of a well-formed page, and an undecoded capture yields a
      // blank one instead of null so the preview has something to render.
      cells: capture.decode_status === 'ok' ? pageToArray(capture.cells) : null,
    });
  } catch (error) {
    serverError(res, 'captures/[id]', error);
  }
}
