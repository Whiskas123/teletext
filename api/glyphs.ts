/**
 * `/api/glyphs` — the shared atlas of characters taught on the import screen.
 *
 * These used to live in `localStorage` under `teletext.import.learnedGlyphs`,
 * which meant every character taught existed on exactly one machine and was one
 * cleared browser profile away from being lost. They are corpus knowledge, not
 * browser state.
 *
 * `GET` is public so the import screen can decode with the full atlas without a
 * sign-in; `POST` requires admin, because this feeds a decoder and a wrong
 * mapping would silently corrupt every page imported afterwards.
 *
 * The key pattern is validated here as well as on the client for that same
 * reason — an atlas key is a stencil, and anything that is not one has no
 * business reaching the decoder.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { db } from './_lib/db';
import { isAdmin } from './_lib/auth';
import { bodyObject, fail, json, methodIs, serverError } from './_lib/http';

/** Matches the client-side check in `ImportArchivePage`. */
const KEY_PATTERN = /^[0-9a-f]{16,80}$/;

/** At most this many taught in one request; a sane bound, not a policy. */
const MAX_PER_REQUEST = 500;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET', 'POST')) return;

  try {
    if (req.method === 'GET') {
      const rows = await db()`select glyph_key, character from learned_glyphs`;
      const glyphs: Record<string, string> = {};
      for (const row of rows) {
        glyphs[String(row.glyph_key)] = String(row.character);
      }
      json(res, 200, { glyphs });
      return;
    }

    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to teach characters.');
      return;
    }

    const submitted = bodyObject(req).glyphs;
    if (submitted == null || typeof submitted !== 'object') {
      fail(res, 400, 'Expected { glyphs: { <stencil>: <character> } }.');
      return;
    }

    const keys: string[] = [];
    const characters: string[] = [];
    let rejected = 0;

    for (const [key, value] of Object.entries(submitted as Record<string, unknown>)) {
      if (!KEY_PATTERN.test(key) || typeof value !== 'string' || value.length === 0) {
        rejected += 1;
        continue;
      }
      keys.push(key);
      characters.push(value);
      if (keys.length >= MAX_PER_REQUEST) break;
    }

    if (keys.length === 0) {
      json(res, 200, { stored: 0, rejected });
      return;
    }

    await db()`
      insert into learned_glyphs (glyph_key, character)
      select * from unnest(${keys}::text[], ${characters}::text[])
      on conflict (glyph_key) do update
        set character = excluded.character, taught_at = now()
    `;

    json(res, 200, { stored: keys.length, rejected });
  } catch (error) {
    serverError(res, 'glyphs', error);
  }
}
