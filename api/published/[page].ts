/**
 * `DELETE /api/published/[page]` — unpublish a page.
 *
 * Clears the record only. The page's content lives in playhtml, and clearing it
 * there is the client's half of the job — same split as publishing, and for the
 * same reason: a serverless function has no connection to the Yjs document.
 *
 * ## The whole carousel, unless one screen is named
 *
 * A page can hold several subpages, each its own record. Without `?subpage=`
 * this takes the page off air entirely, which is what "unpublish page 220"
 * means — leaving screens 2 and 3 recorded as published under a page that no
 * longer is would be a map of something that is not there. `?subpage=2` removes
 * just that screen.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isSubpage } from '../../src/domain/subpages';
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

  const rawSubpage = queryValue(req, 'subpage');
  const subpage = rawSubpage == null ? null : Number(rawSubpage);
  if (subpage != null && !isSubpage(subpage)) {
    fail(res, 400, 'Subpage must be a whole number from 1.');
    return;
  }

  try {
    const rows =
      subpage == null
        ? await db()`
            delete from published_pages
            where page_number = ${pageNumber}
            returning page_number, subpage
          `
        : await db()`
            delete from published_pages
            where page_number = ${pageNumber} and subpage = ${subpage}
            returning page_number, subpage
          `;

    if (rows.length === 0) {
      fail(
        res,
        404,
        subpage == null
          ? `Page ${pageNumber} is not published.`
          : `Page ${pageNumber} subpage ${subpage} is not published.`,
      );
      return;
    }

    json(res, 200, { pageNumber, subpage, published: false, removed: rows.length });
  } catch (error) {
    serverError(res, 'published/[page]', error);
  }
}
