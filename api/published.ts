/**
 * `PUT /api/published` (admin) — render a capture as it would be published:
 * its cells with the shift and the bottom bar applied, returned with the
 * capture's details. **It records nothing.** The browser writes the cells and
 * where they came from in one go (`page-sources`, see
 * `src/domain/pageSource.ts`).
 *
 * The `published_pages` table it is named after is history: its records were
 * moved beside the screens they describe, and the routes that read and resolved
 * them are gone.
 *
 * ## Why this no longer writes
 *
 * A publication used to land in two stores — a row here, the cells in playhtml
 * — written one after the other by the browser, and every renumbering had to
 * move both. Any step that did not finish left them disagreeing, and the page
 * list showed free numbers the server then refused to use. Keeping the record
 * beside the cells, in one store, is what makes that impossible; the table is
 * kept only as the history it already holds.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { toInteger } from '../src/domain/coerce';
import { applyMenu, type MenuItem } from '../src/domain/menu';
import { pageToArray, pageToCellMap } from '../src/domain/pageEncoding';
import { shiftPageDown } from '../src/domain/pageTransform';
import { describeRejection, validatePublication } from '../src/domain/publication';
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
  if (!methodIs(req, res, 'PUT')) return;

  try {
    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to publish.');
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
