// Feature: collaborative-teletext-rooms, Property 10: At most one active change request
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createChangeRequest } from './voting';
import type { ChangeRequest, VoteData } from '../collab/types';

/**
 * Property 10: At most one active change request.
 *
 * For any room state that already has an active Change_Request, `submit`
 * (`createChangeRequest`) is rejected and the existing active Change_Request is
 * retained unchanged — regardless of the requester, present members, or current
 * time.
 *
 * The implementation validates the target range (Req 4.11) before the
 * active-request guard (Req 4.2), so an out-of-range target is rejected with
 * `'out-of-range'` while an otherwise-valid (in-range) target is rejected with
 * `'active-exists'`. Both branches still reject the submission and leave the
 * existing active request untouched, which is exactly what Property 10 asserts:
 * the submission never succeeds and the existing active request is retained.
 *
 * The function is pure and must not mutate `state`, so the caller retains the
 * original active request. We assert the rejection (with reason
 * `'active-exists'` whenever the target is a valid Page_Number) and that
 * `state.active` is deep-equal to a snapshot taken before the call.
 *
 * **Validates: Requirements 4.2**
 */

/** A vote decision. */
const decisionArb: fc.Arbitrary<'accept' | 'reject'> = fc.constantFrom(
  'accept',
  'reject',
);

/** A stable-ish member id. */
const memberIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0);

/**
 * An arbitrary Change_Request already in the ACTIVE state. This is what lives in
 * `state.active` when a second submission arrives.
 */
const activeChangeRequestArb: fc.Arbitrary<ChangeRequest> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 16 }),
    target: fc.integer({ min: 1, max: 999 }),
    requesterId: memberIdArb,
    eligibleMemberIds: fc.uniqueArray(memberIdArb, { minLength: 1, maxLength: 10 }),
    createdAt: fc.integer({ min: 0, max: 10_000_000 }),
  })
  .chain((base) => {
    // Requester is always eligible.
    const eligible = base.eligibleMemberIds.includes(base.requesterId)
      ? base.eligibleMemberIds
      : [...base.eligibleMemberIds, base.requesterId];
    // Record votes for an arbitrary subset of eligible members.
    return fc
      .array(fc.tuple(fc.constantFrom(...eligible), decisionArb), {
        maxLength: eligible.length,
      })
      .map((voteEntries) => {
        const votes: Record<string, 'accept' | 'reject'> = {
          [base.requesterId]: 'accept',
        };
        for (const [memberId, decision] of voteEntries) {
          votes[memberId] = decision;
        }
        const cr: ChangeRequest = {
          id: base.id,
          target: base.target,
          requesterId: base.requesterId,
          voteBase: eligible.length,
          eligibleMemberIds: eligible,
          votes,
          createdAt: base.createdAt,
          status: 'active',
        };
        return cr;
      });
  });

/**
 * A new-submission target: a mix of valid Page_Numbers and out-of-range values,
 * so we confirm the active-request check wins regardless of target validity.
 */
const newTargetArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 100, max: 999 }),
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: -100, max: 0 }),
  fc.integer({ min: 1000, max: 5000 }),
  fc.double({ min: 100, max: 999, noNaN: true }),
);

describe('Property 10: At most one active change request', () => {
  it('rejects submit with active-exists and retains the existing active request unchanged', () => {
    fc.assert(
      fc.property(
        activeChangeRequestArb,
        newTargetArb,
        memberIdArb,
        fc.uniqueArray(memberIdArb, { minLength: 0, maxLength: 12 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (active, newTarget, requesterId, presentMemberIds, now) => {
          const state: VoteData = { active };
          // Deep snapshot of the existing active request before the call.
          const snapshot = structuredClone(active);

          const result = createChangeRequest(
            state,
            newTarget,
            requesterId,
            presentMemberIds,
            now,
          );

          // Submission is always rejected while an active request exists.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            // A valid (in-range integer) target is rejected specifically
            // because an active request already exists; an out-of-range target
            // is rejected by the range guard first. Either way, no request is
            // created.
            const targetIsValid =
              Number.isInteger(newTarget) && newTarget >= 100 && newTarget <= 999;
            expect(result.reason).toBe(
              targetIsValid ? 'active-exists' : 'out-of-range',
            );
          }

          // The existing active request is retained unchanged (not mutated).
          expect(state.active).toEqual(snapshot);
        },
      ),
      { numRuns: 200 },
    );
  });
});
