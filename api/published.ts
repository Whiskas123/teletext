/**
 * `/api/published` — the publication map.
 *
 * - `GET` (public) lists what is published where. The app reads this to show
 *   titles and descriptions alongside the pages, so it is deliberately open.
 * - `PUT` (admin) assigns a capture to a page number with a title and
 *   description, and returns the capture's cells so the client can write them
 *   into playhtml.
 *
 * ## Why PUT returns the cells
 *
 * Publishing has to land in two stores: the database records the decision, and
 * playhtml carries the content visitors actually read. Only a connected browser
 * can write the Yjs document, so the server cannot complete the second half
 * itself. It records the decision, hands back the cells, and the client writes
 * them via `useImportPages` — which already replaces a whole page in one
 * transaction.
 *
 * If the client then fails to write, the database and playhtml disagree: the
 * page is recorded as published but not showing. That is recoverable — the
 * admin screen can re-push any published page — and is the right way round,
 * since the reverse (content live, no record of why) is the state that loses
 * information.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { pageToArray, pageToCellMap } from '../src/domain/pageEncoding';
import { describeRejection, validatePublication } from '../src/domain/publication';
import { db } from './_lib/db';
import { isAdmin } from './_lib/auth';
import { bodyObject, fail, json, methodIs, serverError } from './_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET', 'PUT')) return;

  try {
    if (req.method === 'GET') {
      const rows = await db()`
        select
          p.page_number, p.title, p.description, p.published_at, p.capture_id,
          c.source, c.original_page, c.sub, c.topic, c.scheme,
          c.first_seen, c.manifest_title
        from published_pages p
        join archive_captures c on c.id = p.capture_id
        order by p.page_number
      `;
      json(res, 200, { published: rows });
      return;
    }

    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to publish.');
      return;
    }

    const body = bodyObject(req);
    const captureId = Number(body.captureId);

    // Look the capture up first: validation needs to know whether it exists and
    // whether it was decoded, and neither is something the client can be
    // trusted to assert.
    const found = Number.isInteger(captureId)
      ? await db()`
          select id, decode_status, cells
          from archive_captures
          where id = ${captureId}
        `
      : [];
    const capture = found[0];

    const validated = validatePublication(body, {
      exists: capture != null,
      decoded: capture?.decode_status === 'ok',
    });

    if (!validated.ok) {
      fail(res, 400, describeRejection(validated.reason));
      return;
    }

    const { pageNumber, title, description } = validated.value;

    await db()`
      insert into published_pages
        (page_number, capture_id, title, description, published_at)
      values
        (${pageNumber}, ${captureId}, ${title}, ${description}, now())
      on conflict (page_number) do update
        set capture_id   = excluded.capture_id,
            title        = excluded.title,
            description  = excluded.description,
            published_at = excluded.published_at
    `;

    json(res, 200, {
      pageNumber,
      title,
      description,
      // playhtml's index-keyed shape, so the client can write it straight in.
      cells: pageToCellMap(pageToArray(capture.cells)),
    });
  } catch (error) {
    serverError(res, 'published', error);
  }
}
