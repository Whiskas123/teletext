// Feature: collaborative-teletext-rooms, Property 9: Submitting a change request captures base and requester vote
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createChangeRequest } from './voting';
import type { VoteData } from '../collab/types';

/**
 * Property 9: Submitting a change request captures base and requester vote.
 *
 * For any room state with no active Change_Request and any valid target
 * Page_Number, `createChangeRequest` creates an active Change_Request whose
 * Vote_Base equals the count of members present at that instant, whose eligible
 * members are exactly those present members (deduped, including the requester),
 * and which contains exactly one implicit accept Vote attributed to the
 * requester.
 *
 * **Validates: Requirements 4.1**
 */

// A member id generator: non-empty alphanumeric-ish strings. Kept small so
// generated present-member sets frequently overlap with the requester id,
// exercising both the "requester already present" and "requester absent" paths.
const memberIdArb = fc.string({ minLength: 1, maxLength: 8 });

describe('Property 9: Submitting a change request captures base and requester vote', () => {
  it('captures fixed vote base, eligible members, and the requester implicit accept vote', () => {
    fc.assert(
      fc.property(
        memberIdArb,
        // Present members: may or may not include the requester (the impl
        // force-includes them), and may contain duplicates (deduped by impl).
        fc.array(memberIdArb, { maxLength: 12 }),
        // Whether to explicitly include the requester in the present list.
        fc.boolean(),
        // A valid target Page_Number in 100..999.
        fc.integer({ min: 100, max: 999 }),
        // A now timestamp.
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (requesterId, otherMembers, includeRequester, target, now) => {
          const presentMemberIds = includeRequester
            ? [requesterId, ...otherMembers]
            : [...otherMembers];

          // State with no active Change_Request.
          const state: VoteData = { active: null };

          const result = createChangeRequest(
            state,
            target,
            requesterId,
            presentMemberIds,
            now,
          );

          // Submission succeeds for a valid target with no active request.
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const cr = result.changeRequest;

          // Expected eligible set: the deduped present set, always including the
          // requester (present by definition).
          const expectedEligible = Array.from(
            new Set([...presentMemberIds, requesterId]),
          );

          // Status is active.
          expect(cr.status).toBe('active');

          // Eligible members are exactly the deduped present members (incl. requester).
          expect(new Set(cr.eligibleMemberIds)).toEqual(new Set(expectedEligible));
          // No duplicates in the eligible list.
          expect(cr.eligibleMemberIds.length).toBe(
            new Set(cr.eligibleMemberIds).size,
          );

          // Vote_Base equals the number of distinct eligible members.
          expect(cr.voteBase).toBe(expectedEligible.length);
          expect(cr.voteBase).toBe(cr.eligibleMemberIds.length);

          // Exactly one implicit accept vote, attributed to the requester.
          expect(cr.votes).toEqual({ [requesterId]: 'accept' });
          expect(Object.keys(cr.votes)).toHaveLength(1);

          // Target, requester, and creation time are captured.
          expect(cr.target).toBe(target);
          expect(cr.requesterId).toBe(requesterId);
          expect(cr.createdAt).toBe(now);
        },
      ),
      { numRuns: 200 },
    );
  });
});
