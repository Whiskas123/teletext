import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllPages, getPageNumbers } from '../store';
import { emptyPageJson } from '../validate';
import { getSeedPage } from '../seed-pages';

/**
 * GET /api/pages - returns all 9 pages as { "100": TeletextPage, ... }.
 * Missing pages are returned as empty page JSON.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const raw = await getAllPages();
    const numbers = getPageNumbers();
    const result: Record<string, unknown> = {};
    for (const num of numbers) {
      const str = raw[String(num)];
      if (str) {
        try {
          result[String(num)] = JSON.parse(str);
        } catch {
          result[String(num)] = JSON.parse(emptyPageJson());
        }
      } else {
        const seed = getSeedPage(num);
        result[String(num)] = JSON.parse(seed ?? emptyPageJson());
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
