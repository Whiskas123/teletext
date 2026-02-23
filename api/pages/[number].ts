import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPage, setPage, isValidPageNumber } from '../store';
import { isValidPageBody, emptyPageJson } from '../validate';
import { getSeedPage } from '../seed-pages';

function getNumberFromRequest(req: VercelRequest): number | null {
  const num = req.query.number;
  if (typeof num === 'string') {
    const n = parseInt(num, 10);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

/**
 * GET /api/pages/[number] - return one page. 404 if invalid number.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const num = getNumberFromRequest(req);
  if (num === null || !isValidPageNumber(num)) {
    return res.status(404).json({ error: 'Invalid or missing page number' });
  }

  if (req.method === 'GET') {
    try {
      const raw = await getPage(num);
      const json = raw ?? getSeedPage(num) ?? emptyPageJson();
      const page = JSON.parse(json);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(page);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'PUT') {
    let body: unknown = req.body;
    console.log('[api/pages] PUT', { num, bodyType: typeof body, bodyIsNull: body == null, bodyLength: typeof body === 'string' ? body.length : Array.isArray(body) ? body.length : 'n/a' });
    if (body === undefined || body === null) {
      console.log('[api/pages] PUT 400: Missing request body');
      return res.status(400).json({ error: 'Missing request body' });
    }
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.log('[api/pages] PUT 400: Invalid JSON', e);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const valid = isValidPageBody(body);
    console.log('[api/pages] PUT body valid', valid, Array.isArray(body) ? { length: body.length } : '');
    if (!valid) {
      return res.status(400).json({ error: 'Invalid page body' });
    }
    try {
      await setPage(num, JSON.stringify(body));
      console.log('[api/pages] PUT 200: saved page', num);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[api/pages] PUT 500: setPage failed', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}
