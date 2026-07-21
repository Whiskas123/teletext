// Feature: collaborative-teletext-rooms, Property 13: Change request resolution is correct and clears the active request
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CHANGE_REQUEST_TTL_MS,
  acceptThreshold,
  resolveChangeRequest,
  type ResolutionStatus,
} from './voting';
import type { ChangeRequest } from '../collab/types';

/**
 * Property 13: Change request resolution is correct and clears the active request.
 *
 * For any active Change_Request with any set of Votes, present members, and
 * current time, `resolveChangeRequest` returns:
 *  - **accepted** (and sets the displayed page to the target) iff the accept
 *    Votes among still-present eligible members `>= acceptThreshold(voteBase)`
 *    (Req 4.6);
 *  - **rejected** (retaining the current page) when accept Votes plus the
 *    still-present eligible members who have not yet voted is below the
 *    threshold, so the target can no longer be reached (Req 4.7);
 *  - **expired** (retaining the current page) when at least 60s have elapsed
 *    since creation with no accept/reject resolution (Req 4.9);
 *  - otherwise it stays **active**.
 *
 * Once resolved to any terminal state the active Change_Request is cleared
 * (`active === null`) so a new one may be submitted (Req 4.10). The target is
 * set only when accepted, and `null` otherwise. Resolution is idempotent: an
 * already-resolved request re-resolves to the same terminal status with a
 * cleared active slot.
 *
 * The expected outcome is computed by an independent oracle that mirrors the
 * documented resolution precedence (accepted -> rejected -> expired -> active)
 * derived straight from the acceptance criteria.
 *
 * **Validates: Requirements 4.6, 4.7, 4.9, 4.10**
 */

type VoteChoice = 'none' | 'accept' | 'reject';

/**
 * Independent oracle: recompute the expected resolution directly from the
 * acceptance criteria precedence, without reusing the implementation's
 * internals beyond the documented `acceptThreshold` majority rule.
 */
function expectedResolution(
  cr: ChangeRequest,
  presentMemberIds: readonly string[],
  now: number,
): { status: ResolutionStatus; active: ChangeRequest | null; target: number | null } {
  // Idempotency: an already-resolved request stays resolved with active cleared.
  if (cr.status !== 'active') {
    return {
      status: cr.status,
      active: null,
      target: cr.status === 'accepted' ? cr.target : null,
    };
  }

  const threshold = acceptThreshold(cr.voteBase);
  const present = new Set(presentMemberIds);
  const eligible = new Set(cr.eligibleMemberIds);

  // Accept votes among eligible members still present.
  let accept = 0;
  for (const [id, decision] of Object.entries(cr.votes)) {
    if (!eligible.has(id) || !present.has(id)) continue;
    if (decision === 'accept') accept += 1;
  }

  // 1. Accepted.
  if (accept >= threshold) {
    return { status: 'accepted', active: null, target: cr.target };
  }

  // 2. Rejected: even if every still-present eligible member who has not voted
  // accepted, the threshold could not be reached.
  let presentEligibleNotYetVoted = 0;
  for (const id of eligible) {
    if (!present.has(id)) continue;
    if (!Object.prototype.hasOwnProperty.call(cr.votes, id)) {
      presentEligibleNotYetVoted += 1;
    }
  }
  if (accept + presentEligibleNotYetVoted < threshold) {
    return { status: 'rejected', active: null, target: null };
  }

  // 3. Expired.
  if (now - cr.createdAt >= CHANGE_REQUEST_TTL_MS) {
    return { status: 'expired', active: null, target: null };
  }

  // 4. Still active.
  return { status: 'active', active: cr, target: null };
}

// Build an arbitrary Change_Request plus a present-member set and a `now`,
// spanning below and above createdAt + TTL, and occasionally already-resolved
// for idempotency coverage.
const scenarioArb = fc
  .record({
    eligibleMemberIds: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
      minLength: 1,
      maxLength: 8,
    }),
    target: fc.integer({ min: 1, max: 999 }),
    requesterId: fc.string({ minLength: 1, maxLength: 6 }),
    createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    // Delta relative to createdAt, spanning below and above the 60s TTL.
    nowDelta: fc.integer({ min: 0, max: 2 * CHANGE_REQUEST_TTL_MS }),
    // Weighted towards 'active' so the accepted/rejected/expired branches are
    // frequently exercised, with terminal states for idempotency.
    status: fc.constantFrom<ResolutionStatus>(
      'active',
      'active',
      'active',
      'active',
      'accepted',
      'rejected',
      'expired',
    ),
    // Extra members present who were never eligible (late joiners).
    joiners: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
      minLength: 0,
      maxLength: 4,
    }),
  })
  .chain((base) =>
    fc.record({
      base: fc.constant(base),
      // One vote choice per eligible member.
      voteChoices: fc.array(
        fc.constantFrom<VoteChoice>('none', 'accept', 'reject'),
        {
          minLength: base.eligibleMemberIds.length,
          maxLength: base.eligibleMemberIds.length,
        },
      ),
      // Whether each eligible member is still present.
      stillPresent: fc.array(fc.boolean(), {
        minLength: base.eligibleMemberIds.length,
        maxLength: base.eligibleMemberIds.length,
      }),
    }),
  );

describe('Property 13: Change request resolution is correct and clears the active request', () => {
  it('resolves accepted/rejected/expired/active per precedence, clears active when resolved, and is idempotent', () => {
    fc.assert(
      fc.property(scenarioArb, ({ base, voteChoices, stillPresent }) => {
        const { eligibleMemberIds, target, requesterId, createdAt, nowDelta, status, joiners } =
          base;

        // Assemble votes for eligible members from the per-member choices.
        const votes: Record<string, 'accept' | 'reject'> = {};
        eligibleMemberIds.forEach((id, i) => {
          const choice = voteChoices[i];
          if (choice === 'accept' || choice === 'reject') votes[id] = choice;
        });

        const cr: ChangeRequest = {
          id: `${requesterId}:${target}:${createdAt}`,
          target,
          requesterId,
          voteBase: eligibleMemberIds.length,
          eligibleMemberIds,
          votes,
          createdAt,
          status,
        };

        // Present members: a subset of eligibles plus non-eligible joiners.
        const presentMemberIds = [
          ...eligibleMemberIds.filter((_, i) => stillPresent[i]),
          ...joiners.filter((j) => !eligibleMemberIds.includes(j)),
        ];

        const now = createdAt + nowDelta;

        const result = resolveChangeRequest(cr, presentMemberIds, now);
        const expected = expectedResolution(cr, presentMemberIds, now);

        // Status matches the oracle.
        expect(result.status).toBe(expected.status);

        // Once resolved to a terminal state the active request is cleared;
        // while active the active slot holds the (unchanged) request.
        if (expected.status === 'active') {
          expect(result.active).toBe(cr);
        } else {
          expect(result.active).toBeNull();
        }

        // Target is the request target only when accepted, otherwise null.
        if (expected.status === 'accepted') {
          expect(result.target).toBe(cr.target);
        } else {
          expect(result.target).toBeNull();
        }

        // The returned cr carries the resolved status.
        expect(result.cr.status).toBe(expected.status);

        // Idempotency: re-resolving the returned request yields the same
        // terminal status with the active slot cleared.
        const second = resolveChangeRequest(result.cr, presentMemberIds, now);
        expect(second.status).toBe(result.status);
        if (result.status !== 'active') {
          expect(second.active).toBeNull();
          expect(second.status).toBe(result.status);
          expect(second.target).toBe(result.target);
        }
      }),
      { numRuns: 200 },
    );
  });
});
