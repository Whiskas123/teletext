/**
 * Undo and redo for the editor, as data.
 *
 * Every edit the editor makes is a cell written at an index (see `onEditCell`
 * in `Editor.tsx`), so a step of history is the set of cells one gesture
 * wrote: what each held before, and what it was given. A stroke of the block
 * brush across thirty cells is one step, not thirty — undo takes back what the
 * hand did, not what the pointer reported.
 *
 * Undoing writes the `before` values back through the same cell writer, so it
 * is an edit like any other as far as the shared store is concerned. Nothing
 * here knows about the store: this module only decides which cells go back to
 * what, and keeps the two stacks honest.
 */

import { sameCell } from './pageReuse';
import type { Cell } from '../types/teletext';

/** One cell of one step: what it held when the step began, and what it ended as. */
export interface CellChange {
  before: Cell;
  after: Cell;
}

/** The cells one gesture changed, by index. */
export type HistoryStep = ReadonlyMap<number, CellChange>;

export interface EditHistory {
  /** Oldest first; the step `undo` takes is the last. */
  readonly undo: readonly HistoryStep[];
  /** Oldest first; the step `redo` takes is the last. */
  readonly redo: readonly HistoryStep[];
}

export const EMPTY_HISTORY: EditHistory = { undo: [], redo: [] };

/** How many steps are kept. Past this the oldest is forgotten. */
export const HISTORY_LIMIT = 200;

/**
 * Add a write to a step being built.
 *
 * A cell written twice in one gesture keeps the `before` of its first write —
 * a stroke that crosses back over itself still undoes to what was there before
 * the stroke, not to what the stroke had made of it a moment earlier.
 */
export function recordWrite(
  step: Map<number, CellChange>,
  index: number,
  before: Cell,
  after: Cell,
): void {
  const earlier = step.get(index);
  step.set(index, { before: earlier?.before ?? before, after });
}

/** Whether a step changes anything at all once its writes are netted out. */
export function isEffective(step: HistoryStep): boolean {
  for (const change of step.values()) {
    if (!sameCell(change.before, change.after)) return true;
  }
  return false;
}

/**
 * A finished step joins the undo stack, and the redo stack is dropped — a new
 * edit after an undo starts a new line of history, as everywhere else.
 *
 * A step that nets out to nothing (a blink stroke over cells already blinking,
 * a pixel painted the colour it already was) is not history: pressing undo and
 * seeing nothing happen is worse than it not being there.
 */
export function pushStep(
  history: EditHistory,
  step: HistoryStep,
  limit: number = HISTORY_LIMIT,
): EditHistory {
  if (!isEffective(step)) return history;
  const undo = [...history.undo, step];
  if (undo.length > limit) undo.splice(0, undo.length - limit);
  return { undo, redo: [] };
}

/** The step to take back, and the history once it has been. */
export function takeUndo(
  history: EditHistory,
): { step: HistoryStep; history: EditHistory } | null {
  const step = history.undo.at(-1);
  if (step == null) return null;
  return {
    step,
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, step] },
  };
}

/** The step to put back again, and the history once it has been. */
export function takeRedo(
  history: EditHistory,
): { step: HistoryStep; history: EditHistory } | null {
  const step = history.redo.at(-1);
  if (step == null) return null;
  return {
    step,
    history: { undo: [...history.undo, step], redo: history.redo.slice(0, -1) },
  };
}
