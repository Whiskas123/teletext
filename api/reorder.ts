/**
 * `POST /api/reorder` — renumber published pages in bulk.
 *
 * Two operations, both from `src/domain/reorder.ts`:
 *
 * - `{ action: 'shift', fromPage, delta }` — make room. Pushes every published
 *   page at or above `fromPage` up (or down) by `delta`, so something can be
 *   slotted in before an existing run without republishing each page by hand.
 * - `{ action: 'move', fromPage, toPage }` — reposition one page, sliding the
 *   pages between it and its destination to close the gap.
 *
 * ## The plan is returned, not just applied
 *
 * A page's record lives in Postgres and its *content* lives in playhtml, and
 * only a connected browser can write the latter. So this renumbers the records
 * and hands the client the very same ordered plan to replay against the live
 * document. Both stores end up making identical moves; neither derives its own.
 *
 * ## Why the updates are one row at a time
 *
 * `page_number` is the primary key, so `update … set page_number = page_number
 * + 1` can transiently collide with a row it has not moved yet and fail on the
 * unique index. Postgres would only defer that check for a DEFERRABLE
 * constraint, which a primary key is not here. The plan is already ordered so
 * that each destination is free when written, so applying it row by row inside
 * one transaction is both correct and simple — and there are at most a few
 * hundred published pages.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { toInteger } from '../src/domain/coerce';
import {
  describeReorderRejection,
  planMove,
  planShift,
  type PlanResult,
} from '../src/domain/reorder';
import { db, transaction } from './_lib/db';
import { isAdmin } from './_lib/auth';
import { bodyObject, fail, json, methodIs, serverError } from './_lib/http';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'POST')) return;

  if (!isAdmin(req)) {
    fail(res, 401, 'Sign in to reorder pages.');
    return;
  }

  try {
    const body = bodyObject(req);
    const rows = await db()`select page_number from published_pages order by page_number`;
    const published = rows.map((row) => Number(row.page_number));

    let plan: PlanResult;
    if (body.action === 'shift') {
      plan = planShift(published, toInteger(body.fromPage) ?? NaN, toInteger(body.delta) ?? 0);
    } else if (body.action === 'move') {
      plan = planMove(published, toInteger(body.fromPage) ?? NaN, toInteger(body.toPage) ?? NaN);
    } else {
      fail(res, 400, "action must be 'shift' or 'move'.");
      return;
    }

    if (!plan.ok) {
      fail(res, 400, describeReorderRejection(plan.reason));
      return;
    }

    // The lifted row is read out and re-inserted rather than parked at a spare
    // page number: `page_number` is CHECKed to 100..699, so there is no spare
    // number to park at, and widening that check to make room for a temporary
    // value would weaken a constraint that exists for a good reason.
    const lifted =
      plan.lift == null
        ? null
        : (
            await db()`
              select capture_id, title, description, shift_down, menu_id
              from published_pages where page_number = ${plan.lift}
            `
          )[0];

    if (plan.lift != null && lifted == null) {
      fail(res, 409, 'That page stopped being published while this was in flight.');
      return;
    }

    // Replayed in the same order the client will replay it, inside one
    // transaction so a failure part-way leaves the lifted row where it was.
    await transaction((sql) => {
      const statements = [];
      if (plan.lift != null) {
        statements.push(sql`delete from published_pages where page_number = ${plan.lift}`);
      }
      for (const { from, to } of plan.moves) {
        statements.push(
          sql`update published_pages set page_number = ${to} where page_number = ${from}`,
        );
      }
      if (plan.drop != null && lifted != null) {
        statements.push(sql`
          insert into published_pages
            (page_number, capture_id, title, description, shift_down, menu_id, published_at)
          values
            (${plan.drop}, ${lifted.capture_id}, ${lifted.title}, ${lifted.description},
             ${lifted.shift_down}, ${lifted.menu_id}, now())
        `);
      }
      return statements;
    });

    json(res, 200, {
      lift: plan.lift,
      moves: plan.moves,
      drop: plan.drop,
    });
  } catch (error) {
    serverError(res, 'reorder', error);
  }
}
