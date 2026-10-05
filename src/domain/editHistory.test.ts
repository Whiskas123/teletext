import { describe, expect, it } from 'vitest';

import {
  EMPTY_HISTORY,
  pushStep,
  recordWrite,
  takeRedo,
  takeUndo,
  type CellChange,
} from './editHistory';
import type { Cell } from '../types/teletext';

function cell(char: string, overrides: Partial<Cell> = {}): Cell {
  return { char, fg: 'white', bg: 'black', graphics: null, ...overrides };
}

function stepOf(...writes: [number, Cell, Cell][]): Map<number, CellChange> {
  const step = new Map<number, CellChange>();
  for (const [index, before, after] of writes) recordWrite(step, index, before, after);
  return step;
}

describe('recordWrite', () => {
  it('keeps the first before of a cell written twice in one step', () => {
    const step = stepOf([50, cell(' '), cell('A')], [50, cell('A'), cell('B')]);
    expect(step.get(50)).toEqual({ before: cell(' '), after: cell('B') });
  });
});

describe('pushStep', () => {
  it('adds an effective step and drops the redo stack', () => {
    const first = pushStep(EMPTY_HISTORY, stepOf([50, cell(' '), cell('A')]));
    const undone = takeUndo(first)!.history;
    expect(undone.redo).toHaveLength(1);

    const next = pushStep(undone, stepOf([51, cell(' '), cell('B')]));
    expect(next.undo).toHaveLength(1);
    expect(next.redo).toHaveLength(0);
  });

  it('ignores a step that changes nothing', () => {
    const step = stepOf([50, cell('A'), cell('B')], [50, cell('B'), cell('A')]);
    expect(pushStep(EMPTY_HISTORY, step)).toBe(EMPTY_HISTORY);
  });

  it('forgets the oldest step past the limit', () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 5; i++) {
      history = pushStep(history, stepOf([40 + i, cell(' '), cell('x')]), 3);
    }
    expect(history.undo).toHaveLength(3);
    expect([...history.undo[0].keys()]).toEqual([42]);
  });
});

describe('takeUndo / takeRedo', () => {
  it('moves a step between the two stacks and back', () => {
    const history = pushStep(EMPTY_HISTORY, stepOf([50, cell(' '), cell('A')]));

    const undone = takeUndo(history)!;
    expect(undone.step.get(50)?.before).toEqual(cell(' '));
    expect(undone.history).toEqual({ undo: [], redo: [undone.step] });

    const redone = takeRedo(undone.history)!;
    expect(redone.step).toBe(undone.step);
    expect(redone.history).toEqual({ undo: [undone.step], redo: [] });
  });

  it('has nothing to take from an empty stack', () => {
    expect(takeUndo(EMPTY_HISTORY)).toBeNull();
    expect(takeRedo(EMPTY_HISTORY)).toBeNull();
  });
});
