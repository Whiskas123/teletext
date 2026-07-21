// Feature: collaborative-teletext-rooms, Property 19: Concurrent edits converge deterministically (cell-level CRDT)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compareTimestamps,
  mergeCellMaps,
  reduceCellOps,
  toPageCellMap,
  type CellEditOp,
  type CrdtCellMap,
  type LamportTimestamp,
} from './crdtModel';
import { TELETEXT_COLORS, TOTAL_CELLS, type Cell } from '../types/teletext';
import type { PageCellMap } from '../collab/types';

/**
 * Property 19: Concurrent edits converge deterministically (cell-level CRDT).
 *
 * The page is modelled as a cell-indexed map of independent last-writer-wins
 * registers (per-key LWW keyed by a Lamport-style timestamp with a `clientId`
 * tie-break), mirroring Yjs `Y.Map` semantics. For any set of concurrent cell
 * edits:
 *
 *  1. **Order-independent convergence.** Two replicas that receive the very same
 *     edits in *different* orders converge to one identical `PageCellMap`.
 *  2. **Distinct-cell edits both persist.** Every cell index that was written
 *     appears in the converged map, holding the value of the latest-timestamp
 *     write for that key (verified against an independent oracle).
 *  3. **Same-cell edits resolve to the last write.** When several edits target
 *     the same cell, the converged value is the one with the greatest timestamp
 *     per `compareTimestamps` (greatest `lamport`, `clientId` lexicographic
 *     tie-break).
 *  4. **Merge-based convergence.** Splitting the edits across two replicas and
 *     merging their maps (in either direction) yields the same converged map as
 *     folding all edits directly.
 *
 * Every stamp is made unique (distinct `clientId` per edit), so a single
 * deterministic winner always exists for every key.
 *
 * **Validates: Requirements 6.2, 6.3, 8.5, 9.12**
 */

/** A valid teletext color name. */
const colorArb = fc.constantFrom(...TELETEXT_COLORS);

/** A valid {@link Cell}: defined `char`/`fg`/`bg`; `graphics` unset or 0..63. */
const cellArb: fc.Arbitrary<Cell> = fc.record({
  char: fc.string({ minLength: 1, maxLength: 1 }),
  fg: colorArb,
  bg: colorArb,
  graphics: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
});

/**
 * An arbitrary set of concurrent cell edits.
 *
 * Distinct `clientId`s (via `uniqueArray`) guarantee every stamp is unique, so
 * the per-key winner is always well-defined. Keys are drawn from the full valid
 * cell-index range and are allowed to collide across edits (exercising both
 * distinct-cell and same-cell resolution). `lamport` values are allowed to
 * collide too, so the `clientId` tie-break is exercised.
 */
const editOpsArb: fc.Arbitrary<CellEditOp[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 20 })
  .chain((clientIds) =>
    fc
      .record({
        keys: fc.array(fc.integer({ min: 0, max: TOTAL_CELLS - 1 }), {
          minLength: clientIds.length,
          maxLength: clientIds.length,
        }),
        values: fc.array(cellArb, {
          minLength: clientIds.length,
          maxLength: clientIds.length,
        }),
        lamports: fc.array(fc.integer({ min: 0, max: 15 }), {
          minLength: clientIds.length,
          maxLength: clientIds.length,
        }),
      })
      .map(({ keys, values, lamports }) =>
        clientIds.map((clientId, i) => ({
          key: keys[i],
          value: values[i],
          stamp: { lamport: lamports[i], clientId } as LamportTimestamp,
        })),
      ),
  );

/** A set of edits paired with an arbitrary full-length permutation of it. */
const opsWithPermutationArb = editOpsArb.chain((ops) =>
  fc
    .shuffledSubarray(ops, { minLength: ops.length, maxLength: ops.length })
    .map((permutation) => ({ ops, permutation })),
);

/** A set of edits paired with a full-length permutation and a split index. */
const opsWithSplitArb = editOpsArb.chain((ops) =>
  fc
    .record({
      permutation: fc.shuffledSubarray(ops, {
        minLength: ops.length,
        maxLength: ops.length,
      }),
      splitAt: fc.integer({ min: 0, max: ops.length }),
    })
    .map(({ permutation, splitAt }) => ({ ops, permutation, splitAt })),
);

/**
 * Oracle: independently compute the converged {@link PageCellMap}. For each key,
 * the winning value is the edit with the greatest timestamp (greatest `lamport`,
 * `clientId` lexicographic tie-break).
 */
function oracleConverged(ops: readonly CellEditOp[]): PageCellMap {
  const winners = new Map<number, CellEditOp>();
  for (const op of ops) {
    const current = winners.get(op.key);
    if (!current || compareTimestamps(op.stamp, current.stamp) > 0) {
      winners.set(op.key, op);
    }
  }
  const result: PageCellMap = {};
  for (const [key, op] of winners) {
    result[key] = op.value;
  }
  return result;
}

describe('Property 19: Concurrent edits converge deterministically (cell-level CRDT)', () => {
  it('converges to one identical PageCellMap regardless of the order edits are received', () => {
    fc.assert(
      fc.property(opsWithPermutationArb, ({ ops, permutation }) => {
        const replicaA = toPageCellMap(reduceCellOps(ops));
        const replicaB = toPageCellMap(reduceCellOps(permutation));
        // Order-independent convergence: both replicas agree exactly.
        expect(replicaB).toEqual(replicaA);
      }),
      { numRuns: 200 },
    );
  });

  it('preserves every written cell at its latest-timestamp value (distinct + same key)', () => {
    fc.assert(
      fc.property(editOpsArb, (ops) => {
        const converged = toPageCellMap(reduceCellOps(ops));
        const expected = oracleConverged(ops);

        // Same key set: every distinct cell that was written survives, and no
        // spurious cells appear.
        expect(new Set(Object.keys(converged))).toEqual(new Set(Object.keys(expected)));

        // Each cell holds the greatest-timestamp writer's value — distinct-cell
        // edits keep their own value; same-cell edits resolve to the last write.
        expect(converged).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('same-cell edits resolve to the greatest-timestamp writer per compareTimestamps', () => {
    fc.assert(
      fc.property(editOpsArb, (ops) => {
        const converged = toPageCellMap(reduceCellOps(ops));
        // For every key, confirm the converged value is the greatest-timestamp
        // edit among all edits that targeted that key.
        const keys = new Set(ops.map((op) => op.key));
        for (const key of keys) {
          const forKey = ops.filter((op) => op.key === key);
          const winner = forKey.reduce((best, op) =>
            compareTimestamps(op.stamp, best.stamp) > 0 ? op : best,
          );
          expect(converged[key]).toEqual(winner.value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('converges the same whether edits are folded directly or split across two merged replicas', () => {
    fc.assert(
      fc.property(opsWithSplitArb, ({ ops, permutation, splitAt }) => {
        const expected = toPageCellMap(reduceCellOps(ops));

        // Split a permuted delivery across two replicas, then merge their maps.
        const left: CrdtCellMap = reduceCellOps(permutation.slice(0, splitAt));
        const right: CrdtCellMap = reduceCellOps(permutation.slice(splitAt));

        // Merge is commutative: either direction yields the same converged map,
        // matching the direct fold of all edits.
        expect(toPageCellMap(mergeCellMaps(left, right))).toEqual(expected);
        expect(toPageCellMap(mergeCellMaps(right, left))).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});
