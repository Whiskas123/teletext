/**
 * `/api/showcase` — the pages chosen for the front page, and their pictures.
 *
 * - `GET` (public) lists the strip in order. Every visitor reads this, so it is
 *   deliberately open, and it carries no image bytes — just what is on the
 *   strip and in what order.
 * - `GET ?page=&subpage=&format=image` (public) returns one picture.
 * - `PUT` (admin) puts a page on the strip, with the picture the browser drew.
 * - `DELETE` (admin) takes one off.
 *
 * ## Why the picture is uploaded rather than rendered here
 *
 * A page's cells live in playhtml, which only a connected browser can read — a
 * serverless function has no Yjs connection. So the moderator's browser draws
 * the page and posts the result, exactly as publishing has the browser write
 * the cells the server hands it (see `api/published.ts`).
 *
 * ## Why the image shares this route
 *
 * Vercel's Hobby plan caps how many functions a deployment may have, and an
 * image endpoint is not worth one of them — the same reason
 * `api/captures/[id].ts` serves its renders under `?format=image`.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { toInteger } from '../src/domain/coerce';
import { inPageRange } from '../src/domain/pageOps';
import { isSubpage } from '../src/domain/subpages';
import { validateTitle } from '../src/domain/titles';
import { db } from './_lib/db';
import { isAdmin } from './_lib/auth';
import { bodyObject, fail, json, methodIs, queryValue, serverError } from './_lib/http';

/**
 * Largest picture accepted, in bytes of decoded image.
 *
 * A 560x432 teletext page is flat colour and hard edges, so a PNG of one runs
 * to a few kilobytes; a megabyte is far past anything this route should be
 * storing and well short of what would trouble the database. The bound is here
 * because the bytes come from a client.
 */
const MAX_IMAGE_BYTES = 1024 * 1024;

/** Neon returns `bytea` as a `\x…` hex string over the HTTP driver. */
function toBuffer(raw: unknown): Buffer {
  return Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(String(raw).replace(/^\\x/, ''), 'hex');
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET', 'PUT', 'DELETE')) return;

  try {
    if (req.method === 'GET') {
      // One picture.
      if (queryValue(req, 'format') === 'image') {
        const pageNumber = Number(queryValue(req, 'page'));
        const subpage = Number(queryValue(req, 'subpage') ?? '1');
        if (!inPageRange(pageNumber) || !isSubpage(subpage)) {
          fail(res, 400, 'Ask for a page between 100 and 999, and a valid subpage.');
          return;
        }

        const rows = await db()`
          select image, image_type, updated_at from showcase_pages
          where page_number = ${pageNumber} and subpage = ${subpage}
        `;
        const stored = rows[0];
        if (stored?.image == null) {
          fail(res, 404, 'That page is not on the showcase.');
          return;
        }

        res.setHeader('Content-Type', String(stored.image_type ?? 'image/png'));
        // A `v` in the URL is the row's `updated_at`, so that URL's bytes can
        // never change: cache it for a year. Without one the URL is stable
        // across a redraw, so it may only be held briefly — otherwise pressing
        // Redraw would change the picture on the server and nothing on screen.
        res.setHeader(
          'Cache-Control',
          queryValue(req, 'v') == null
            ? 'public, max-age=60'
            : 'public, max-age=31536000, immutable',
        );
        res.status(200).send(toBuffer(stored.image));
        return;
      }

      // The strip itself. No bytes: the browser asks for the pictures it needs
      // by URL, which lets them cache separately from the list.
      const rows = await db()`
        select page_number, subpage, position, title, updated_at
        from showcase_pages
        order by position, page_number, subpage
      `;
      json(res, 200, { showcase: rows });
      return;
    }

    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to choose what the front page shows.');
      return;
    }

    if (req.method === 'DELETE') {
      const pageNumber = Number(queryValue(req, 'page'));
      const subpage = Number(queryValue(req, 'subpage') ?? '1');
      if (!inPageRange(pageNumber) || !isSubpage(subpage)) {
        fail(res, 400, 'Name a page between 100 and 999, and a valid subpage.');
        return;
      }

      const rows = await db()`
        delete from showcase_pages
        where page_number = ${pageNumber} and subpage = ${subpage}
        returning page_number
      `;
      if (rows.length === 0) {
        fail(res, 404, `Page ${pageNumber} is not on the showcase.`);
        return;
      }
      json(res, 200, { pageNumber, subpage, showcased: false });
      return;
    }

    // PUT: put a page on the strip, with the picture the browser drew.
    const body = bodyObject(req);
    const pageNumber = toInteger(body.pageNumber);
    const subpage = body.subpage === undefined ? 1 : toInteger(body.subpage);
    const position = toInteger(body.position) ?? 0;

    if (pageNumber == null || !inPageRange(pageNumber)) {
      fail(res, 400, 'Page number must be between 100 and 999.');
      return;
    }
    if (subpage == null || !isSubpage(subpage)) {
      fail(res, 400, 'Subpage must be a whole number from 1.');
      return;
    }

    const title = validateTitle(typeof body.title === 'string' ? body.title : '');
    if (!title.ok) {
      fail(res, 400, 'Title must be 60 characters or fewer.');
      return;
    }

    // The picture arrives base64-encoded in JSON: it is a few kilobytes, and a
    // multipart upload for that would be more machinery than it saves.
    const encoded = typeof body.image === 'string' ? body.image : '';
    const base64 = encoded.replace(/^data:[^,]*,/, '');
    if (base64.length === 0) {
      fail(res, 400, 'No picture was sent for that page.');
      return;
    }

    const image = Buffer.from(base64, 'base64');
    if (image.length === 0) {
      fail(res, 400, 'That picture could not be decoded.');
      return;
    }
    if (image.length > MAX_IMAGE_BYTES) {
      fail(res, 413, 'That picture is larger than a teletext page should ever be.');
      return;
    }

    const imageType = typeof body.imageType === 'string' ? body.imageType : 'image/png';

    await db()`
      insert into showcase_pages
        (page_number, subpage, position, image, image_type, title, updated_at)
      values
        (${pageNumber}, ${subpage}, ${position}, ${image}, ${imageType},
         ${title.value}, now())
      on conflict (page_number, subpage) do update
        set position   = excluded.position,
            image      = excluded.image,
            image_type = excluded.image_type,
            title      = excluded.title,
            updated_at = excluded.updated_at
    `;

    json(res, 200, { pageNumber, subpage, position, showcased: true });
  } catch (error) {
    serverError(res, 'showcase', error);
  }
}
