/**
 * `POST /api/reorder` — renumber published pages in bulk.
 *
 * Two operations, both from `src/domain/reorder.ts`:
 *
 * - `{ action: 'shift', fromPage, delta }` — make room. Pushes every occupied
 *   page at or above `fromPage` by `delta`, so a run of new pages can be
 *   slotted in without touching any of them by hand.
 * - `{ action: 'move', blockStart, blockEnd, destination }` — move a run of
 *   pages elsewhere, sliding what it passes over to close the gap behind it.
 *
 * ## Occupancy comes from both stores
 *
 * The caller sends `livePages`: every page number holding content in the
 * playhtml document. Only a connected browser can see that, and planning
 * without it was a real bug — a hand-made page at 201 does not appear in
 * `published_pages`, so shifting 200 up overwrote it. The two lists are unioned
 * here, so the plan accounts for every page that exists rather than only the
 * ones the archive knows about.
 *
 * A signed-in admin could of course understate that list, but the only document
 * they would damage is their own, and they can already edit it directly.
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
 * `page_number` is part of the primary key, so `update … set page_number =
 * page_number + 1` can transiently collide with a row it has not moved yet and
 * fail on the unique index. Postgres would only defer that check for a
 * DEFERRABLE constraint, which a primary key is not here. The plan is already
 * ordered so that each destination is free when written, so applying it row by
 * row inside one transaction is both correct and simple — and there are at most
 * a few hundred published pages.
 *
 * ## Subpages move as one
 *
 * A page can hold several subpages, each its own row (see
 * `db/migrations/008_subpages.sql`). The plan is over page *numbers* and knows
 * nothing about them, which is right: the subpages of a page are the page, and
 * moving 220 to 305 has to take all of its screens along. So the statements
 * here match on `page_number` alone and carry however many rows that is, and a
 * lift reads and re-inserts the whole set rather than a single row.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { toInteger } from '../src/domain/coerce';
import {
  PLAYGROUND_MIN_PAGE,
  describeReorderRejection,
  planMoveBlock,
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
    // Distinct: a page with three subpages is three rows and one position.
    const rows = await db()`
      select distinct page_number from published_pages order by page_number
    `;
    const published = rows.map((row) => Number(row.page_number));

    // Everything holding content, from both stores. A page in one and not the
    // other is still a page, and moving onto it would destroy it.
    const live = Array.isArray(body.livePages)
      ? body.livePages.map((page) => toInteger(page)).filter((p): p is number => p != null)
      : [];
    const occupied = [...new Set([...published, ...live])];

    let plan: PlanResult;
    if (body.action === 'shift') {
      plan = planShift(occupied, toInteger(body.fromPage) ?? NaN, toInteger(body.delta) ?? 0);
    } else if (body.action === 'move') {
      plan = planMoveBlock(
        occupied,
        toInteger(body.blockStart) ?? NaN,
        toInteger(body.blockEnd) ?? NaN,
        toInteger(body.destination) ?? NaN,
      );
    } else {
      fail(res, 400, "action must be 'shift' or 'move'.");
      return;
    }

    if (!plan.ok) {
      fail(res, 400, describeReorderRejection(plan.reason, plan.blocking));
      return;
    }

    // A published page may not land in the playground. 700..999 is open to
    // every visitor (`src/domain/access.ts`), so curated content there could be
    // edited by anyone — which is why `published_pages.page_number` is CHECKed
    // to 100..699. Caught here rather than left to the constraint so the
    // operator gets a reason instead of a failed transaction, and so the live
    // document is not moved for a renumbering the records will refuse.
    const publishedSet = new Set(published);
    const strays = [...plan.moves, ...plan.drops]
      .filter(({ from, to }) => publishedSet.has(from) && to >= PLAYGROUND_MIN_PAGE)
      .map(({ to }) => to);
    if (strays.length > 0) {
      fail(
        res,
        400,
        `That would move archive pages to ${strays.slice(0, 5).join(', ')}, which is ` +
          `the open playground (${PLAYGROUND_MIN_PAGE}+) where anyone may edit them.`,
      );
      return;
    }

    // Lifted rows are read out and re-inserted rather than parked at spare page
    // numbers: `page_number` is CHECKed to 100..699, so there are no spare
    // numbers to park at, and widening that check to make room for temporary
    // values would weaken a constraint that exists for a good reason.
    //
    // Only pages the archive published have a row at all. A lifted page that is
    // purely a live one simply has nothing to carry here, and the client moves
    // its content on its own. Every subpage of a lifted page is held, not just
    // its first screen.
    const lifted = new Map<number, Record<string, unknown>[]>();
    for (const page of plan.lifts) {
      const found = await db()`
        select subpage, capture_id, title, description, shift_down, menu_id
        from published_pages where page_number = ${page}
      `;
      if (found.length > 0) lifted.set(page, found);
    }

    // Replayed in the same order the client will replay it, inside one
    // transaction so a failure part-way leaves the records as they were.
    await transaction((sql) => {
      const statements = [];
      for (const page of plan.lifts) {
        statements.push(sql`delete from published_pages where page_number = ${page}`);
      }
      for (const { from, to } of plan.moves) {
        statements.push(
          sql`update published_pages set page_number = ${to} where page_number = ${from}`,
        );
      }
      for (const { from, to } of plan.drops) {
        for (const row of lifted.get(from) ?? []) {
          statements.push(sql`
            insert into published_pages
              (page_number, subpage, capture_id, title, description, shift_down,
               menu_id, published_at)
            values
              (${to}, ${row.subpage}, ${row.capture_id}, ${row.title}, ${row.description},
               ${row.shift_down}, ${row.menu_id}, now())
          `);
        }
      }
      return statements;
    });

    json(res, 200, {
      lifts: plan.lifts,
      moves: plan.moves,
      drops: plan.drops,
    });
  } catch (error) {
    serverError(res, 'reorder', error);
  }
}
