/**
 * `GET /api/health` — is the function runtime routed, and is the database reachable?
 *
 * Exists mainly to prove the `vercel.json` rewrite is right. The SPA catch-all
 * used to be `/(.*)`, which swallowed every function call and returned
 * `index.html` with a 200 — so a broken API looked exactly like a working one.
 * If this returns JSON, routing is correct.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { db, isConfigured } from './_lib/db';
import { json, methodIs } from './_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // HEAD too: it is what most uptime monitors send.
  if (!methodIs(req, res, 'GET', 'HEAD')) return;

  if (!isConfigured()) {
    json(res, 200, { ok: true, database: 'unconfigured' });
    return;
  }

  try {
    const rows = await db()`
      select
        (select count(*) from archive_captures) as captures,
        (select count(*) from live_pages where source is not null) as published,
        (select count(*) from live_pages)       as live,
        (select count(*) from learned_glyphs)   as glyphs
    `;
    const counts = rows[0] ?? {};
    json(res, 200, {
      ok: true,
      database: 'connected',
      counts: {
        captures: Number(counts.captures ?? 0),
        published: Number(counts.published ?? 0),
        live: Number(counts.live ?? 0),
        glyphs: Number(counts.glyphs ?? 0),
      },
    });
  } catch (error) {
    // A 503, so an uptime check sees it as down. The detail stays in the log:
    // a driver error can name tables, or the connection string (see
    // `serverError`), and this route is public.
    console.error('[health]', error);
    json(res, 503, { ok: false, database: 'error' });
  }
}
