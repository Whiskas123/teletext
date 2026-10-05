/**
 * Undo and redo, wrapped around the editor's one cell writer.
 *
 * Everything the editor changes goes through `write`, which passes the cell on
 * to the host and remembers what was there before. Writes are gathered into a
 * step either for the length of a synchronous `transact` (a typed character,
 * which may clear the row under a double-height glyph as well) or between
 * `begin` and `commit` (a stroke, which lasts as long as the pointer is down).
 * A write outside both is a step of its own.
 *
 * What a cell held *before* is read from the last value this editor wrote to
 * it while the page has not caught up yet, and from the page once it has: a
 * stroke writes many cells between two renders, and the page it was handed
 * does not know about any of them.
 *
 * History belongs to one screen of one page. Moving to another clears it —
 * undoing a stroke on a page you are no longer looking at would be an edit
 * nobody could see being made.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  EMPTY_HISTORY,
  pushStep,
  recordWrite,
  takeRedo,
  takeUndo,
  type CellChange,
  type EditHistory,
  type HistoryStep,
} from '../../domain/editHistory';
import { sameCell } from '../../domain/pageReuse';
import type { Cell, TeletextPage } from '../../types/teletext';

export function useEditHistory(
  page: TeletextPage,
  onEditCell: (index: number, cell: Cell) => void,
  /** Changes when the screen being edited does; history is cleared with it. */
  screenKey: string,
) {
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY);
  const historyRef = useRef(history);
  const openRef = useRef<Map<number, CellChange> | null>(null);
  /** Cells written here that the page has not reflected yet. */
  const pendingRef = useRef(new Map<number, Cell>());
  const pageRef = useRef(page);

  useLayoutEffect(() => {
    pageRef.current = page;
    // Once the page shows a written value, the page is the authority again —
    // if somebody else then edits that cell, undo should restore from theirs.
    for (const [index, cell] of pendingRef.current) {
      const shown = page[index];
      if (shown != null && sameCell(shown, cell)) pendingRef.current.delete(index);
    }
  }, [page]);

  const replace = useCallback((next: EditHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  useEffect(() => {
    openRef.current = null;
    pendingRef.current.clear();
    replace(EMPTY_HISTORY);
  }, [screenKey, replace]);

  const put = useCallback(
    (index: number, cell: Cell) => {
      onEditCell(index, cell);
      pendingRef.current.set(index, cell);
    },
    [onEditCell],
  );

  const current = useCallback(
    (index: number): Cell | undefined =>
      pendingRef.current.get(index) ?? pageRef.current[index],
    [],
  );

  /** Start gathering writes into one step (idempotent). */
  const begin = useCallback(() => {
    openRef.current ??= new Map();
  }, []);

  /** Close the step being gathered, if there is one (idempotent). */
  const commit = useCallback(() => {
    const step = openRef.current;
    openRef.current = null;
    if (step != null) replace(pushStep(historyRef.current, step));
  }, [replace]);

  /** Run `fn` with every write it makes counted as one step. */
  const transact = useCallback(
    (fn: () => void) => {
      if (openRef.current != null) {
        fn();
        return;
      }
      begin();
      try {
        fn();
      } finally {
        commit();
      }
    },
    [begin, commit],
  );

  const write = useCallback(
    (index: number, cell: Cell) => {
      const before = current(index);
      put(index, cell);
      if (before == null) return;
      if (openRef.current != null) {
        recordWrite(openRef.current, index, before, cell);
        return;
      }
      const step = new Map<number, CellChange>();
      recordWrite(step, index, before, cell);
      replace(pushStep(historyRef.current, step));
    },
    [current, put, replace],
  );

  const apply = useCallback(
    (step: HistoryStep, side: keyof CellChange) => {
      for (const [index, change] of step) put(index, change[side]);
    },
    [put],
  );

  const undo = useCallback(() => {
    commit();
    const taken = takeUndo(historyRef.current);
    if (taken == null) return;
    apply(taken.step, 'before');
    replace(taken.history);
  }, [apply, commit, replace]);

  const redo = useCallback(() => {
    commit();
    const taken = takeRedo(historyRef.current);
    if (taken == null) return;
    apply(taken.step, 'after');
    replace(taken.history);
  }, [apply, commit, replace]);

  return {
    write,
    transact,
    begin,
    commit,
    undo,
    redo,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
  };
}
