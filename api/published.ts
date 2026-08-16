/**
 * `/api/published` — the publication map.
 *
 * - `GET` (public) lists what is published where. The app reads this to show
 *   titles and descriptions alongside the pages, so it is deliberately open.
 * - `PUT` (admin) assigns a capture to a page number with a title and
 *   description, and returns the capture's cells so the client can write them
 *   into playhtml.
 * - `DELETE ?page=&subpage=` (admin) unpublishes. Without `subpage` it takes
 *   the whole carousel off air, which is what "unpublish page 220" means —
 *   leaving screens 2 and 3 recorded under a page that is no longer published
 *   would be a map of something that is not there.
 *
 * ## Why DELETE lives here rather than at `/api/published/[page]`
 *
 * It had its own file, and its own serverless function with it. Vercel's Hobby
 * plan caps a deployment at twelve, and this project reached thirteen — the
 * same reason `api/captures/[id].ts` serves its images under `?format=image`
 * instead of taking a route of its own. One resource, one function.
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
  queryValue,
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
      const target = Number(queryValue(req, 'page'));
      if (!isPublishablePage(target)) {
        fail(res, 400, 'Page number must be between 100 and 699.');
        return;
      }

      const rawSubpage = queryValue(req, 'subpage');
      const subpage = rawSubpage == null ? null : Number(rawSubpage);
      if (subpage != null && !isSubpage(subpage)) {
        fail(res, 400, 'Subpage must be a whole number from 1.');
        return;
      }

      const removed =
        subpage == null
          ? await db()`
              delete from published_pages
              where page_number = ${target}
              returning page_number, subpage
            `
          : await db()`
              delete from published_pages
              where page_number = ${target} and subpage = ${subpage}
              returning page_number, subpage
            `;

      if (removed.length === 0) {
        fail(
          res,
          404,
          subpage == null
            ? `Page ${target} is not published.`
            : `Page ${target} subpage ${subpage} is not published.`,
        );
        return;
      }

      json(res, 200, {
        pageNumber: target,
        subpage,
        published: false,
        removed: removed.length,
      });
      return;
    }

    const body = bodyObject(req);
    const captureId = toInteger(body.captureId);

    // Look the capture up first: validation needs to know whether it exists and
    // whether it was decoded, and neither is something the client can be
    // trusted to assert.
    const found = captureId != null
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

    const { pageNumber, subpage, title, description } = validated.value;

    // The transforms, in the order they have to happen: shifting moves the
    // capture's own bottom row off the page, and only then is there a clean
    // last row for the menu to occupy. Doing it the other way round would
    // write the menu and immediately shift it away.
    const shiftDown = body.shiftDown === true;
    const menuId = toInteger(body.menuId);
    const useMenu = menuId != null && menuId > 0;

    const menuRows = useMenu
      ? await db()`select id, items from custom_menus where id = ${menuId}`
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

    await db()`
      insert into published_pages
        (page_number, subpage, capture_id, title, description, shift_down, menu_id, published_at)
      values
        (${pageNumber}, ${subpage}, ${captureId}, ${title}, ${description},
         ${shiftDown}, ${useMenu ? menuId : null}, now())
      on conflict (page_number, subpage) do update
        set capture_id   = excluded.capture_id,
            title        = excluded.title,
            description  = excluded.description,
            shift_down   = excluded.shift_down,
            menu_id      = excluded.menu_id,
            published_at = excluded.published_at
    `;

    json(res, 200, {
      pageNumber,
      subpage,
      title,
      description,
      shiftDown,
      menuId: useMenu ? menuId : null,
      // playhtml's index-keyed shape, so the client can write it straight in.
      cells: pageToCellMap(page),
    });
  } catch (error) {
    serverError(res, 'published', error);
  }
}
