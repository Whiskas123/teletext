/**
 * `/api/published` — rendering a capture for publication, and the old records.
 *
 * - `PUT` (admin) renders a capture as it would be published — its cells with
 *   the shift and the bottom bar applied — and returns them with the capture's
 *   details. **It records nothing.** The browser writes the cells and where they
 *   came from into playhtml in one go (`page-sources`, see
 *   `src/domain/pageSource.ts`), and the live mirror copies both into the
 *   database like every other change.
 * - `GET` (public) lists the records this table held before that — when it was
 *   a second, hand-synchronised map of which capture was on which number. Read
 *   once by `/manage` to move them into playhtml.
 * - `DELETE` (admin, body `{ records: [[page, subpage], …] }`) marks such
 *   records as dealt with. They stay in the table, as history; `GET` stops
 *   offering them.
 *
 * ## Why this no longer writes
 *
 * A publication used to land in two stores — a row here, the cells in playhtml
 * — written one after the other by the browser, and every renumbering had to
 * move both. Any step that did not finish left them disagreeing, and the page
 * list showed free numbers the server then refused to use. Keeping the record
 * beside the cells, in one store, is what makes that impossible; the table is
 * kept only as the history it already holds.
 *
 * ## Why DELETE lives here rather than at `/api/published/[page]`
 *
 * Vercel's Hobby plan caps a deployment at twelve functions. One resource, one
 * function.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { toInteger } from '../src/domain/coerce';
import { applyMenu, type MenuItem } from '../src/domain/menu';
import { pageToArray, pageToCellMap } from '../src/domain/pageEncoding';
import { shiftPageDown } from '../src/domain/pageTransform';
import {
  describeRejection,
  isPublishablePage,
  validatePublication,
} from '../src/domain/publication';
import { isSubpage } from '../src/domain/subpages';
import { db } from './_lib/db';
import { isAdmin } from './_lib/auth';
import {
  bodyObject,
  fail,
  json,
  methodIs,
  serverError,
} from './_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET', 'PUT', 'DELETE')) return;

  try {
    if (req.method === 'GET') {
      const rows = await db()`
        select
          p.page_number, p.subpage, p.title, p.description, p.published_at,
          p.capture_id, p.shift_down, p.menu_id,
          c.source, c.original_page, c.sub, c.topic, c.scheme,
          c.first_seen, c.manifest_title,
          m.name as menu_name
        from published_pages p
        join archive_captures c on c.id = p.capture_id
        left join custom_menus m on m.id = p.menu_id
        where p.resolved_at is null
        order by p.page_number, p.subpage
      `;
      json(res, 200, { published: rows });
      return;
    }

    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to publish.');
      return;
    }

    if (req.method === 'DELETE') {
      // Marks old records as dealt with — moved into playhtml, restored, or
      // discarded — rather than deleting them: the table is history now, and
      // `GET` simply stops offering them.
      const body = bodyObject(req);
      const raw: unknown[] = Array.isArray(body.records) ? body.records : [];
      const pairs = raw
        .map((item) => (Array.isArray(item) ? [toInteger(item[0]), toInteger(item[1])] : [null, null]))
        .filter(
          (pair): pair is [number, number] =>
            pair[0] != null && isPublishablePage(pair[0]) && pair[1] != null && isSubpage(pair[1]),
        )
        .slice(0, 1000);
      if (pairs.length === 0) {
        fail(res, 400, 'Name the records as [page, subpage] pairs.');
        return;
      }

      const resolved = await db()`
        update published_pages p
        set resolved_at = now()
        from unnest(${pairs.map((p) => p[0])}::int[], ${pairs.map((p) => p[1])}::int[])
          as t(page_number, subpage)
        where p.page_number = t.page_number and p.subpage = t.subpage
          and p.resolved_at is null
        returning p.page_number
      `;
      json(res, 200, { resolved: resolved.length });
      return;
    }

    const body = bodyObject(req);
    const captureId = toInteger(body.captureId);

    // Look the capture up first: validation needs to know whether it exists and
    // whether it was decoded, and neither is something the client can be
    // trusted to assert.
    const found = captureId != null
      ? await db()`
          select id, decode_status, cells, source, original_page, sub, topic,
                 scheme, first_seen, manifest_title
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

    const { pageNumber, subpage } = validated.value;

    // The transforms, in the order they have to happen: shifting moves the
    // capture's own bottom row off the page, and only then is there a clean
    // last row for the menu to occupy.
    const shiftDown = body.shiftDown === true;
    const menuId = toInteger(body.menuId);
    const useMenu = menuId != null && menuId > 0;

    const menuRows = useMenu
      ? await db()`select id, name, items from custom_menus where id = ${menuId}`
      : [];
    if (useMenu && menuRows.length === 0) {
      fail(res, 400, 'That menu no longer exists.');
      return;
    }

    let page = pageToArray(capture.cells);
    if (shiftDown) page = shiftPageDown(page);
    if (menuRows.length > 0) {
      page = applyMenu(page, { items: menuRows[0].items as MenuItem[] });
    }

    json(res, 200, {
      pageNumber,
      subpage,
      // playhtml's index-keyed shape, so the client can write it straight in.
      cells: pageToCellMap(page),
      // What the browser stores beside the cells, in `page-sources`.
      source: {
        captureId: Number(capture.id),
        source: capture.source,
        originalPage: Number(capture.original_page),
        sub: capture.sub ?? '',
        topic: capture.topic ?? null,
        scheme: capture.scheme ?? null,
        firstSeen: capture.first_seen == null ? null : new Date(capture.first_seen).toISOString(),
        manifestTitle: capture.manifest_title ?? null,
        shiftDown,
        menuId: useMenu ? menuId : null,
        menuName: menuRows[0]?.name ?? null,
        publishedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    serverError(res, 'published', error);
  }
}
