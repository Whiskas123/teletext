/**
 * CRDT merge model for Collaborative Teletext Rooms.
 *
 * This module is a pure, framework-free model of the last-writer-wins (LWW)
 * merge semantics that playhtml's Yjs-backed store provides. It exists so the
 * correctness properties that depend on CRDT convergence can be exercised by
 * property-based tests without a live server (see design "CRDT model testing";
 * Properties 7 and 19).
 *
 * Two concerns are modelled:
 *
 * 1. A single-value **LWW register** (used for the room's displayed Page_Number
 *    convergence — Requirement 3.9 / Property 7).
 * 2. A **cell-indexed map** whose entries are independent LWW registers keyed by
 *    cell index (used for collaborative cell editing — Requirements 6.2, 6.3,
 *    8.5, 9.12 / Property 19). Concurrent writes to *different* keys both
 *    survive; concurrent writes to the *same* key converge to a single
 *    deterministic winner.
 *
 * Determinism mirrors `Y.Map`: each write carries a Lamport-style timestamp with
 * a client id tie-break, so the merged result is independent of the order in
 * which writes are received.
 */

import type { Cell, PageCellMap } from '../collab/types';

/**
 * A Lamport-style logical timestamp with a client tie-break.
 *
 * `lamport` is a monotonically increasing logical clock value; `clientId`
 * disambiguates concurrent writes that share the same `lamport` value. This
 * mirrors how Yjs orders concurrent operations (logical clock plus a stable
 * per-client id).
 */
export interface LamportTimestamp {
  /** Logical clock value; higher means "later". */
  lamport: number;
  /** Stable per-client identifier used to break ties deterministically. */
  clientId: string;
}

/**
 * A last-writer-wins register holding a value and the timestamp of the write
 * that produced it.
 */
export interface LwwRegister<T> {
  value: T;
  stamp: LamportTimestamp;
}

/**
 * A write to a single cell of the page, keyed by cell index (`0..959`).
 */
export interface CellEditOp {
  /** Cell index within the page (`0..959`). */
  key: number;
  /** The new cell value. */
  value: Cell;
  /** Logical timestamp of this write. */
  stamp: LamportTimestamp;
}

/**
 * A write to the room's displayed Page_Number.
 */
export interface PageChangeOp {
  /** The requested displayed Page_Number. */
  pageNumber: number;
  /** Logical timestamp of this write. */
  stamp: LamportTimestamp;
}

/**
 * A cell-indexed map of LWW registers. This is the CRDT-internal representation
 * that carries per-cell timestamps; use {@link toPageCellMap} to project it to
 * the plain {@link PageCellMap} the rest of the app consumes.
 */
export type CrdtCellMap = Record<number, LwwRegister<Cell>>;

/**
 * Compare two Lamport timestamps deterministically.
 *
 * Returns a positive number when `a` is "later" than `b`, a negative number
 * when `a` is "earlier", and `0` only when the timestamps are identical
 * (same `lamport` and same `clientId`). Later is defined as a higher `lamport`
 * value, with ties broken by the lexicographically greater `clientId` — the
 * same total order Yjs applies to concurrent writes.
 */
export function compareTimestamps(a: LamportTimestamp, b: LamportTimestamp): number {
  if (a.lamport !== b.lamport) {
    return a.lamport - b.lamport;
  }
  if (a.clientId === b.clientId) {
    return 0;
  }
  return a.clientId > b.clientId ? 1 : -1;
}

/**
 * Merge two LWW registers, returning the one with the later timestamp. When
 * either side is `null`/`undefined`, the other is returned. This is
 * commutative, associative, and idempotent — the defining properties of a CRDT
 * merge — so replicas converge regardless of receive order.
 */
export function mergeRegister<T>(
  a: LwwRegister<T> | null | undefined,
  b: LwwRegister<T> | null | undefined,
): LwwRegister<T> | null {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return compareTimestamps(a.stamp, b.stamp) >= 0 ? a : b;
}

/**
 * Fold a set of writes to a single LWW register into the converged register.
 *
 * The result is the write with the latest timestamp and is independent of the
 * order in which the writes appear in the array (CRDT convergence). Returns
 * `initial` (default `null`) when there are no writes.
 */
export function reduceRegister<T>(
  writes: readonly LwwRegister<T>[],
  initial: LwwRegister<T> | null = null,
): LwwRegister<T> | null {
  return writes.reduce<LwwRegister<T> | null>(
    (acc, w) => mergeRegister(acc, w),
    initial,
  );
}

/**
 * Apply a single cell write to a CRDT cell map, returning a new map (the input
 * is not mutated). The write wins for its key only if its timestamp is later
 * than the existing register for that key.
 */
export function applyCellOp(map: CrdtCellMap, op: CellEditOp): CrdtCellMap {
  const incoming: LwwRegister<Cell> = { value: op.value, stamp: op.stamp };
  const winner = mergeRegister(map[op.key], incoming);
  return { ...map, [op.key]: winner as LwwRegister<Cell> };
}

/**
 * Merge two CRDT cell maps key-by-key. Keys present in only one map are kept as
 * is (distinct-cell edits both survive); keys present in both converge to the
 * register with the later timestamp. Commutative, associative, and idempotent.
 */
export function mergeCellMaps(a: CrdtCellMap, b: CrdtCellMap): CrdtCellMap {
  const result: CrdtCellMap = { ...a };
  for (const key of Object.keys(b)) {
    const index = Number(key);
    const merged = mergeRegister(result[index], b[index]);
    if (merged) {
      result[index] = merged;
    }
  }
  return result;
}

/**
 * Fold an ordered sequence of cell writes into a converged CRDT cell map.
 *
 * Because each write carries a timestamp and merging is order-independent, the
 * resulting map is identical for any permutation of `ops` (this is what
 * Property 19 asserts across arbitrary interleavings). Returns a shallow copy of
 * `initial` (default empty) when there are no writes.
 */
export function reduceCellOps(
  ops: readonly CellEditOp[],
  initial: CrdtCellMap = {},
): CrdtCellMap {
  return ops.reduce<CrdtCellMap>((acc, op) => applyCellOp(acc, op), { ...initial });
}

/**
 * Project a CRDT cell map (with per-cell timestamps) to the plain
 * {@link PageCellMap} the application consumes, dropping the merge metadata.
 */
export function toPageCellMap(map: CrdtCellMap): PageCellMap {
  const result: PageCellMap = {};
  for (const key of Object.keys(map)) {
    const index = Number(key);
    result[index] = map[index].value;
  }
  return result;
}

/**
 * Reduce an ordered sequence of displayed-page changes to the single converged
 * Page_Number for every replica (Requirement 3.9 / Property 7).
 *
 * The displayed Page_Number is a single LWW register: applying a fixed sequence
 * of writes converges to the value carried by the write with the latest
 * timestamp, and — because the merge is order-independent — every replica agrees
 * on that value regardless of the order in which it received the writes. When a
 * sequence is applied in order with monotonically increasing timestamps, this is
 * exactly the "most recently applied" Page_Number.
 *
 * Returns `initial` (default `null`) when there are no operations.
 */
export function reduceDisplayedPage(
  ops: readonly PageChangeOp[],
  initial: number | null = null,
): number | null {
  const writes: LwwRegister<number>[] = ops.map((op) => ({
    value: op.pageNumber,
    stamp: op.stamp,
  }));
  const converged = reduceRegister(writes);
  return converged ? converged.value : initial;
}
