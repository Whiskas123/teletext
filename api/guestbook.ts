/**
 * `/api/guestbook` — the book of signatures.
 *
 * - `GET` — every signature, newest first, as the page shows them. Public,
 *   compressed, and cached at the edge for a few seconds: a new signature
 *   reaches other readers on their next refresh (the page asks every half
 *   minute), which is as live as a guestbook needs to be.
 * - `POST { name, cells, authorId }` — sign. Checked by the same rules the
 *   form applies (`validateSignature`), so a client cannot store what the page
 *   would refuse; the id and the time are the server's, not the client's.
 * - `DELETE ?id=` (admin) — take a signature out of the book.
 *
 * Until October 2026 the book lived in playhtml (see
 * `db/migrations/013_guestbook.sql` for why it moved).
 */

import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { compactSnippet, normalizeSnippet, validateSignature } from '../src/domain/guestbook';
import { isAdmin } from './_lib/auth';
import { db } from './_lib/db';
import { bodyObject, clientKey, fail, json, methodIs, queryValue, serverError } from './_lib/http';

/**
 * How many signatures one response carries. A known ceiling, not a design:
 * at a few kilobytes each compressed, past this the book wants paging.
 */
const MAX_ENTRIES = 1000;

/** One author may sign this often, which is plenty for a person and slows a script. */
const MIN_SECONDS_BETWEEN = 20;

/**
 * And one address this many times an hour, whatever author id it sends — the
 * author id comes from the browser, so on its own it limits nobody who does not
 * want to be limited. Generous, because a room full of people at a workshop
 * shares one address.
 */
const MAX_PER_ADDRESS_PER_HOUR = 30;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET', 'POST', 'DELETE')) return;

  try {
    if (req.method === 'GET') {
      const rows = await db()`
        select id, name, author_id, cells, ts from guestbook_entries
        order by ts desc, id
        limit ${MAX_ENTRIES}
      `;
      const entries = rows.map((row) => ({
        id: row.id,
        name: row.name,
        authorId: row.author_id,
        cells: row.cells,
        ts: Number(row.ts),
      }));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=60');
      res.status(200).send(gzipSync(JSON.stringify({ entries })));
      return;
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) {
        fail(res, 401, 'Sign in to take signatures out of the book.');
        return;
      }
      const id = queryValue(req, 'id') ?? '';
      const rows = await db()`delete from guestbook_entries where id = ${id} returning id`;
      if (rows.length === 0) {
        fail(res, 404, 'No such signature.');
        return;
      }
      json(res, 200, { id, deleted: true });
      return;
    }

    const body = bodyObject(req);
    const cells = normalizeSnippet(body.cells);
    const validation = validateSignature(typeof body.name === 'string' ? body.name : '', cells);
    if (!validation.ok) {
      fail(res, 400, validation.reason);
      return;
    }
    const authorId = typeof body.authorId === 'string' ? body.authorId.slice(0, 64) : '';
    const client = clientKey(req);

    const [recent] = await db()`
      select
        count(*) filter (
          where ${authorId} <> '' and author_id = ${authorId}
            and created_at > now() - make_interval(secs => ${MIN_SECONDS_BETWEEN})
        )::int as by_author,
        count(*) filter (where client = ${client})::int as by_address
      from guestbook_entries
      where created_at > now() - interval '1 hour'
    `;
    if ((recent?.by_author ?? 0) > 0 || (recent?.by_address ?? 0) >= MAX_PER_ADDRESS_PER_HOUR) {
      fail(res, 429, 'too-soon');
      return;
    }

    const entry = {
      id: randomUUID(),
      name: validation.name,
      authorId,
      cells: compactSnippet(cells),
      ts: Date.now(),
    };
    await db()`
      insert into guestbook_entries (id, name, author_id, client, cells, ts)
      values (${entry.id}, ${entry.name}, ${entry.authorId}, ${client}, ${JSON.stringify(entry.cells)}::jsonb, ${entry.ts})
    `;
    json(res, 201, { entry });
  } catch (error) {
    serverError(res, 'guestbook', error);
  }
}
