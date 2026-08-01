/**
 * `DELETE /api/published/[page]` — unpublish a page.
 *
 * Clears the record only. The page's content lives in playhtml, and clearing it
 * there is the client's half of the job — same split as publishing, and for the
 * same reason: a serverless function has no connection to the Yjs document.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isPublishablePage } from '../../src/domain/publication';
import { db } from '../_lib/db';
import { isAdmin } from '../_lib/auth';
import { fail, json, methodIs, queryValue, serverError } from '../_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'DELETE')) return;

  if (!isAdmin(req)) {
    fail(res, 401, 'Sign in to unpublish.');
    return;
  }

  const pageNumber = Number(queryValue(req, 'page'));
  if (!isPublishablePage(pageNumber)) {
    fail(res, 400, 'Page number must be between 100 and 699.');
    return;
  }

  try {
    const rows = await db()`
      delete from published_pages
      where page_number = ${pageNumber}
      returning page_number
    `;

    if (rows.length === 0) {
      fail(res, 404, `Page ${pageNumber} is not published.`);
      return;
    }

    json(res, 200, { pageNumber, published: false });
  } catch (error) {
    serverError(res, 'published/[page]', error);
  }
}
