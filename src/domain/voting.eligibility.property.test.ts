// Feature: collaborative-teletext-rooms, Property 11: One vote per eligible member, base fixed, eligibility enforced
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { castVote, createChangeRequest, tally, type VoteDecision } from './voting';
import type { VoteData } from '../collab/types';

/**
 * Property 11: One vote per eligible member, base fixed, eligibility enforced.
 *
 * For any active Change_Request:
 *  - an eligible member who has not yet voted may record exactly one accept or
 *    reject Vote (castVote ok, decision recorded);
 *  - a second Vote by that same member is rejected with reason 'already-voted'
 *    and the original Vote is retained (request unchanged);
 *  - a Vote from a member who was not present at creation is rejected with
 *    reason 'ineligible';
 *  - a Vote attributed to a member who has left is discarded in the tally;
 *  - and the Vote_Base remains fixed at its creation value regardless of joins
 *    or leaves.
 *
 * **Validates: Requirements 4.3, 4.4, 4.8**
 */

const decisionArb = fc.constantFrom<VoteDecision>('accept', 'reject');

// A scenario: a pool of distinct members present at creation (with at least one
// eligible non-requester so the "records a vote" case is always exercised), a
// target page, one decision per member, a present/left mask, and new joiners.
const scenarioArb = fc
  .record({
    memberIds: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
      minLength: 2,
      maxLength: 8,
    }),
    target: fc.integer({ min: 100, max: 999 }),
    now: fc.integer({ min: 0, max: 10_000_000 }),
  })
  .chain(({ memberIds, target, now }) =>
    fc.record({
      memberIds: fc.constant(memberIds),
      target: fc.constant(target),
      now: fc.constant(now),
      // A decision for each member (indexed positionally).
      decisions: fc.array(decisionArb, {
        minLength: memberIds.length,
        maxLength: memberIds.length,
      }),
      // Whether each member is still present after joins/leaves settle.
      stillPresent: fc.array(fc.boolean(), {
        minLength: memberIds.length,
        maxLength: memberIds.length,
      }),
      // Extra members who join after creation (never eligible).
      joiners: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
        minLength: 0,
        maxLength: 4,
      }),
      // Seed used to derive an id guaranteed absent from the eligible set.
      foreignSeed: fc.string({ minLength: 0, maxLength: 8 }),
    }),
  );

describe('Property 11: One vote per eligible member, base fixed, eligibility enforced', () => {
  it('enforces one vote per eligible member, rejects ineligible/late members, and keeps the base fixed', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { memberIds, target, now, decisions, stillPresent, joiners, foreignSeed } =
          scenario;

        // Requester is the first member; the rest are eligible non-requesters.
        const requesterId = memberIds[0];
        const eligibleNonRequesters = memberIds.slice(1);

        const state: VoteData = { active: null };
        const created = createChangeRequest(state, target, requesterId, memberIds, now);
        expect(created.ok).toBe(true);
        if (!created.ok) return; // narrow for the type checker

        const cr = created.changeRequest;
        const originalVoteBase = cr.voteBase;

        // --- One eligible member records exactly one vote (Req 4.3) ---
        const voter = eligibleNonRequesters[0];
        const voterDecision = decisions[1]; // decision aligned to that member
        const first = castVote(cr, voter, voterDecision);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.cr.votes[voter]).toBe(voterDecision);
        // Input is never mutated. Use hasOwnProperty rather than bracket access
        // so member ids that collide with Object.prototype keys (e.g. "valueOf",
        // "toString", "__proto__") are handled correctly: `cr.votes[voter]`
        // would otherwise read an inherited prototype member instead of an own
        // vote entry.
        expect(Object.prototype.hasOwnProperty.call(cr.votes, voter)).toBe(false);

        // --- A second vote by the same member is rejected, original retained (Req 4.4) ---
        const otherDecision: VoteDecision =
          voterDecision === 'accept' ? 'reject' : 'accept';
        const second = castVote(first.cr, voter, otherDecision);
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.reason).toBe('already-voted');
        // The returned request is unchanged: the original decision is retained.
        expect(second.cr).toBe(first.cr);
        expect(second.cr.votes[voter]).toBe(voterDecision);

        // --- A member not present at creation is rejected as ineligible (Req 4.8) ---
        let foreignId = `ext:${foreignSeed}`;
        while (cr.eligibleMemberIds.includes(foreignId)) foreignId += '_';
        const late = castVote(first.cr, foreignId, 'accept');
        expect(late.ok).toBe(false);
        if (late.ok) return;
        expect(late.reason).toBe('ineligible');
        expect(late.cr).toBe(first.cr);

        // --- Every eligible member votes so the tally has something to discard ---
        let filled = cr;
        memberIds.forEach((id, i) => {
          if (id === requesterId) return; // requester already has an implicit accept
          const res = castVote(filled, id, decisions[i]);
          expect(res.ok).toBe(true);
          if (res.ok) filled = res.cr;
        });

        // --- Simulate joins/leaves and tally: base fixed, absent votes discarded ---
        const presentMemberIds = [
          ...memberIds.filter((_, i) => stillPresent[i]),
          ...joiners.filter((j) => !memberIds.includes(j)),
        ];
        const result = tally(filled, presentMemberIds);

        // Vote_Base is fixed regardless of joins/leaves (Req 4.8).
        expect(filled.voteBase).toBe(originalVoteBase);
        expect(result.base).toBe(originalVoteBase);

        // Tally counts only votes from eligible members who are still present;
        // votes attributed to members who have left are discarded.
        const present = new Set(presentMemberIds);
        let expectedAccept = 0;
        let expectedReject = 0;
        for (const [id, decision] of Object.entries(filled.votes)) {
          if (!filled.eligibleMemberIds.includes(id)) continue;
          if (!present.has(id)) continue; // left the room -> discarded
          if (decision === 'accept') expectedAccept += 1;
          else expectedReject += 1;
        }
        expect(result.accept).toBe(expectedAccept);
        expect(result.reject).toBe(expectedReject);
      }),
      { numRuns: 200 },
    );
  });
});
