/**
 * `GET /api/captures/[id]` — one capture, cells included, for previewing.
 *
 * Separate from the list route precisely because of the cells: ~59 KB each,
 * fine for the one page being looked at, ruinous for sixty rows of results.
 *
 * `?format=image` returns the stored render instead — the actual GIF or PNG the
 * archive holds, re-encoded as lossless WebP. This is what the browser's
 * thumbnails are. It shares this route rather than taking one of its own
 * because Vercel's Hobby plan caps how many functions a deployment may have,
 * and an image endpoint is not worth one of them.
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
    if (queryValue(req, 'format') === 'image') {
      const rows = await db()`
        select image, image_type from archive_captures where id = ${id}
      `;
      const stored = rows[0];
      if (stored?.image == null) {
        fail(res, 404, 'No image stored for that capture.');
        return;
      }

      // Neon returns bytea as a `\x…` hex string over the HTTP driver.
      const raw: unknown = stored.image;
      const buffer = Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(String(raw).replace(/^\\x/, ''), 'hex');

      res.setHeader('Content-Type', String(stored.image_type ?? 'image/webp'));
      // A capture's render never changes once imported, so this can be cached
      // hard. `private` because the browser is admin-only: a shared cache must
      // not hold archive images for someone who is not signed in.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.status(200).send(buffer);
      return;
    }

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
