// Feature: collaborative-teletext-rooms, Property 14: Change request target is range-validated
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createChangeRequest } from './voting';
import type { VoteData } from '../collab/types';

/**
 * Property 14: Change request target is range-validated.
 *
 * For any value, `createChangeRequest` (the `submit` path) is rejected and no
 * active Change_Request is created **iff** the target is not an integer within
 * the inclusive range 100 to 999.
 *
 * Concretely, starting from a room state with no active Change_Request:
 *  - when the target IS an integer in 100..999, submission succeeds
 *    (`result.ok === true`) and an active Change_Request is produced;
 *  - otherwise (floats, NaN, +/-Infinity, negatives, zero, 1..99, values > 999)
 *    submission is rejected with `result.ok === false` and reason
 *    `'out-of-range'`, and no Change_Request is created.
 *
 * The expected outcome is decided by an independent oracle
 * (`Number.isInteger(t) && t >= 100 && t <= 999`) rather than by re-using the
 * production range check.
 *
 * **Validates: Requirements 4.11**
 */

const NUM_RUNS = 200;

// Independent oracle: exactly the set of valid targets.
function isValidTarget(t: number): boolean {
  return Number.isInteger(t) && t >= 100 && t <= 999;
}

// A generator that spans the whole relevant input space: in-range integers,
// below-range integers (1..99, 0, negatives), above-range integers (> 999),
// non-integer floats, and the special numeric values NaN / +Infinity / -Infinity.
const targetArb: fc.Arbitrary<number> = fc.oneof(
  // In-range integers 100..999 (valid).
  fc.integer({ min: 100, max: 999 }),
  // Below-range integers 1..99 (invalid now).
  fc.integer({ min: 1, max: 99 }),
  // Zero and negatives (invalid).
  fc.integer({ min: -1000, max: 0 }),
  // Above the upper bound (invalid).
  fc.integer({ min: 1000, max: 1_000_000 }),
  // Arbitrary floats, including non-integers within and outside the range.
  fc.double({ min: -2000, max: 2000, noNaN: true }),
  // Special values.
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

describe('Property 14: Change request target is range-validated', () => {
  it('accepts a submission iff the target is an integer in 100..999, otherwise rejects with no active request', () => {
    fc.assert(
      fc.property(
        targetArb,
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
          minLength: 0,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (target, requesterId, presentMemberIds, now) => {
          const state: VoteData = { active: null };
          const result = createChangeRequest(
            state,
            target,
            requesterId,
            presentMemberIds,
            now,
          );

          if (isValidTarget(target)) {
            // Valid target -> submission succeeds and a request is created.
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.changeRequest.target).toBe(target);
              expect(result.changeRequest.status).toBe('active');
            }
          } else {
            // Invalid target -> rejected as out-of-range, no request created.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.reason).toBe('out-of-range');
            }
            // The caller's state is never mutated into an active request.
            expect(state.active).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects representative out-of-range boundary and non-integer targets', () => {
    const state: VoteData = { active: null };
    for (const bad of [0, 1, 99, 1000, -1, 100.5, 999.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createChangeRequest(state, bad, 'req', ['req'], 0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('out-of-range');
    }
  });

  it('accepts the inclusive boundaries 100 and 999', () => {
    const state: VoteData = { active: null };
    for (const good of [100, 999]) {
      const result = createChangeRequest(state, good, 'req', ['req'], 0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.changeRequest.target).toBe(good);
    }
  });
});
