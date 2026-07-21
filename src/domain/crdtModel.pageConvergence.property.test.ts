// Feature: collaborative-teletext-rooms, Property 7: Ordered page changes converge to the last applied value
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compareTimestamps,
  reduceDisplayedPage,
  type LamportTimestamp,
  type PageChangeOp,
} from './crdtModel';

/**
 * Property 7: Ordered page changes converge to the last applied value.
 *
 * For any finite sequence of valid displayed-page-change operations applied in
 * a fixed order, every replica converges to the most recently applied
 * Page_Number. Because the room's displayed Page_Number is a single
 * last-writer-wins register keyed by a Lamport-style timestamp (with a
 * `clientId` tie-break), the converged value is the Page_Number carried by the
 * write with the greatest timestamp — and that result is independent of the
 * order in which a replica receives the writes.
 *
 * This test asserts two facets of that guarantee:
 *
 *  1. When operations are applied in order with strictly increasing timestamps,
 *     `reduceDisplayedPage` yields the Page_Number of the last (most recently
 *     applied) operation.
 *  2. For an arbitrary set of operations (including ties on `lamport` broken by
 *     `clientId`), every permutation of the operations converges to the same
 *     latest-timestamp value.
 *
 * **Validates: Requirements 3.9**
 */

/** Distinct, varied client identifiers so every stamp is unique and the
 * lexicographic `clientId` tie-break is exercised. */
const clientIdsArb = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 6 }),
  { minLength: 1, maxLength: 15 },
);

/** A valid displayed Page_Number (1..999). */
const pageNumberArb = fc.integer({ min: 1, max: 999 });

/**
 * A sequence applied "in order": operations carry strictly increasing
 * `lamport` values (index-based), so the final operation is unambiguously the
 * most recently applied one. Distinct `clientId`s keep every stamp unique.
 */
const orderedOpsArb: fc.Arbitrary<PageChangeOp[]> = clientIdsArb.chain((clientIds) =>
  fc
    .array(pageNumberArb, { minLength: clientIds.length, maxLength: clientIds.length })
    .map((pages) =>
      clientIds.map((clientId, i) => ({
        pageNumber: pages[i],
        stamp: { lamport: i, clientId },
      })),
    ),
);

/**
 * An arbitrary set of operations with distinct `clientId`s but freely chosen
 * `lamport` values, so ties on `lamport` occur and must be resolved by the
 * `clientId` tie-break. Every stamp is still unique (distinct clientIds), so a
 * single deterministic winner always exists.
 */
const unorderedOpsArb: fc.Arbitrary<PageChangeOp[]> = clientIdsArb.chain((clientIds) =>
  fc
    .record({
      lamports: fc.array(fc.integer({ min: 0, max: 20 }), {
        minLength: clientIds.length,
        maxLength: clientIds.length,
      }),
      pages: fc.array(pageNumberArb, {
        minLength: clientIds.length,
        maxLength: clientIds.length,
      }),
    })
    .map(({ lamports, pages }) =>
      clientIds.map((clientId, i) => ({
        pageNumber: pages[i],
        stamp: { lamport: lamports[i], clientId } as LamportTimestamp,
      })),
    ),
);

/** A set of operations paired with an arbitrary full-length permutation of it. */
const opsWithPermutationArb = unorderedOpsArb.chain((ops) =>
  fc
    .shuffledSubarray(ops, { minLength: ops.length, maxLength: ops.length })
    .map((permutation) => ({ ops, permutation })),
);

/** Oracle: the Page_Number of the operation with the greatest timestamp. */
function latestPageNumber(ops: readonly PageChangeOp[]): number {
  const winner = ops.reduce((best, op) =>
    compareTimestamps(op.stamp, best.stamp) > 0 ? op : best,
  );
  return winner.pageNumber;
}

describe('Property 7: Ordered page changes converge to the last applied value', () => {
  it('converges to the most recently applied Page_Number for an in-order sequence', () => {
    fc.assert(
      fc.property(orderedOpsArb, (ops) => {
        const lastApplied = ops[ops.length - 1].pageNumber;
        expect(reduceDisplayedPage(ops)).toBe(lastApplied);
        // The last applied value is also the greatest-timestamp value.
        expect(reduceDisplayedPage(ops)).toBe(latestPageNumber(ops));
      }),
      { numRuns: 200 },
    );
  });

  it('converges to the same latest-timestamp value regardless of operation order', () => {
    fc.assert(
      fc.property(opsWithPermutationArb, ({ ops, permutation }) => {
        const expected = latestPageNumber(ops);
        // Order-independent convergence: any permutation yields the same value.
        expect(reduceDisplayedPage(permutation)).toBe(expected);
        expect(reduceDisplayedPage(permutation)).toBe(reduceDisplayedPage(ops));
      }),
      { numRuns: 200 },
    );
  });
});
