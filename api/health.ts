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
  if (!methodIs(req, res, 'GET')) return;

  if (!isConfigured()) {
    json(res, 200, { ok: true, database: 'unconfigured' });
    return;
  }

  try {
    const rows = await db()`
      select
        (select count(*) from archive_captures) as captures,
        (select count(*) from published_pages)  as published,
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
    // Report rather than 500: an unmigrated database is a normal state during
    // setup, and the point of this route is to say which state you are in.
    json(res, 200, {
      ok: false,
      database: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
