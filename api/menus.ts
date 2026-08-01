/**
 * `/api/menus` — the saved four-colour fastext strips.
 *
 * - `GET` (public) lists them. Open because the app may want to show where a
 *   page's coloured links point without a sign-in.
 * - `PUT` (admin) creates or updates one, keyed by id.
 * - `DELETE` (admin) removes one; pages using it keep their published cells and
 *   simply lose the association (`on delete set null`).
 *
 * Validation is `src/domain/menu.ts`, the same module the admin screen renders
 * its preview from, so what is previewed and what is stored cannot drift.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { describeMenuRejection, validateMenu } from '../src/domain/menu';
import { db } from './_lib/db';
import { isAdmin } from './_lib/auth';
import {
  bodyObject,
  fail,
  json,
  methodIs,
  queryInt,
  serverError,
} from './_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET', 'PUT', 'DELETE')) return;

  try {
    if (req.method === 'GET') {
      const rows = await db()`
        select id, name, items, updated_at
        from custom_menus
        order by name
      `;
      json(res, 200, { menus: rows });
      return;
    }

    if (!isAdmin(req)) {
      fail(res, 401, 'Sign in to manage menus.');
      return;
    }

    if (req.method === 'DELETE') {
      const id = queryInt(req, 'id', 0, 1, Number.MAX_SAFE_INTEGER);
      if (id === 0) {
        fail(res, 400, 'Which menu? Pass ?id=<menu id>.');
        return;
      }
      const rows = await db()`delete from custom_menus where id = ${id} returning id`;
      if (rows.length === 0) {
        fail(res, 404, 'No such menu.');
        return;
      }
      json(res, 200, { id, deleted: true });
      return;
    }

    const body = bodyObject(req);
    const validated = validateMenu(body);
    if (!validated.ok) {
      fail(res, 400, describeMenuRejection(validated.reason));
      return;
    }
    const { name, items } = validated.value;

    // An id means "update that one"; without it this is a new menu. Names are
    // unique, so re-saving under an existing name updates rather than failing —
    // the alternative is a duplicate-name error for what is obviously an edit.
    const id = Number(body.id);
    const rows = Number.isInteger(id) && id > 0
      ? await db()`
          update custom_menus
          set name = ${name}, items = ${JSON.stringify(items)}::jsonb, updated_at = now()
          where id = ${id}
          returning id, name, items, updated_at
        `
      : await db()`
          insert into custom_menus (name, items)
          values (${name}, ${JSON.stringify(items)}::jsonb)
          on conflict (name) do update
            set items = excluded.items, updated_at = now()
          returning id, name, items, updated_at
        `;

    if (rows.length === 0) {
      fail(res, 404, 'No such menu.');
      return;
    }

    json(res, 200, { menu: rows[0] });
  } catch (error) {
    serverError(res, 'menus', error);
  }
}
