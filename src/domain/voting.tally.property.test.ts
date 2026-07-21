// Feature: collaborative-teletext-rooms, Property 12: Vote tally equals recorded votes
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createChangeRequest, castVote, tally, acceptThreshold, type VoteDecision } from './voting';
import type { VoteData } from '../collab/types';

/**
 * Property 12: Vote tally equals recorded votes.
 *
 * For any set of recorded Votes on an active Change_Request, the accept and
 * reject tallies equal the number of accept and reject Votes among eligible
 * members who are still present. An independent oracle recomputes the expected
 * counts directly from the votes map, the eligible set, and the present set,
 * and the reported `base`/`threshold` are checked against the fixed Vote_Base.
 *
 * **Validates: Requirements 4.5**
 */

const NUM_RUNS = 200;

const decisionArb = fc.constantFrom<VoteDecision>('accept', 'reject');

// A scenario builds a real active Change_Request via the domain API (requester
// + present members at creation), records a decision for each eligible
// non-requester member, then applies an arbitrary present/left mask plus late
// joiners who are never eligible.
const scenarioArb = fc
  .record({
    memberIds: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
      minLength: 1,
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
      // Which eligible non-requesters actually cast a vote.
      castMask: fc.array(fc.boolean(), {
        minLength: memberIds.length,
        maxLength: memberIds.length,
      }),
      // Which of the original members are still present at tally time.
      stillPresent: fc.array(fc.boolean(), {
        minLength: memberIds.length,
        maxLength: memberIds.length,
      }),
      // Extra members who join after creation (never eligible).
      joiners: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
        minLength: 0,
        maxLength: 4,
      }),
    }),
  );

describe('Property 12: Vote tally equals recorded votes', () => {
  it('accept/reject tallies equal recorded votes among eligible+present members; base and threshold are fixed', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { memberIds, target, now, decisions, castMask, stillPresent, joiners } =
          scenario;

        const requesterId = memberIds[0];

        const state: VoteData = { active: null };
        const created = createChangeRequest(state, target, requesterId, memberIds, now);
        expect(created.ok).toBe(true);
        if (!created.ok) return; // narrow for the type checker

        // Record votes for the eligible non-requesters chosen by castMask.
        let cr = created.changeRequest;
        memberIds.forEach((id, i) => {
          if (id === requesterId) return; // requester already has an implicit accept
          if (!castMask[i]) return;
          const res = castVote(cr, id, decisions[i]);
          expect(res.ok).toBe(true);
          if (res.ok) cr = res.cr;
        });

        // Present members = original members flagged present + late joiners.
        const presentMemberIds = [
          ...memberIds.filter((_, i) => stillPresent[i]),
          ...joiners.filter((j) => !memberIds.includes(j)),
        ];

        const result = tally(cr, presentMemberIds);

        // Independent oracle: count accept/reject among members that are both
        // eligible and present, straight from the recorded votes map.
        const eligible = new Set(cr.eligibleMemberIds);
        const present = new Set(presentMemberIds);
        let expectedAccept = 0;
        let expectedReject = 0;
        for (const [id, decision] of Object.entries(cr.votes)) {
          if (!eligible.has(id) || !present.has(id)) continue;
          if (decision === 'accept') expectedAccept += 1;
          else expectedReject += 1;
        }

        expect(result.accept).toBe(expectedAccept);
        expect(result.reject).toBe(expectedReject);
        expect(result.base).toBe(cr.voteBase);
        expect(result.threshold).toBe(Math.floor(cr.voteBase / 2) + 1);
        expect(result.threshold).toBe(acceptThreshold(cr.voteBase));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
