/**
 * Tests for the recently-used list behind the brush and text-style strips.
 *
 * The ordering rules are here because they are easy to get wrong, and the
 * identity rule is here because it is invisible: recording happens on *use*,
 * and use is continuous — a stroke records once per cell it paints — so a
 * recorder that returns a fresh object for an unchanged list turns every cell
 * of every stroke into a React state change and a re-render of the editor.
 */

import { describe, expect, it } from 'vitest';

import { recordRecent, stepRecent, type RecentList } from './recentList';

const equals = (a: string, b: string) => a === b;

function list(history: string[], index = 0): RecentList<string> {
  return { history, index };
}

describe('recordRecent', () => {
  it('puts a newly used item at the front', () => {
    const next = recordRecent(list(['b', 'c']), 'a', equals, 8);
    expect(next.history).toEqual(['a', 'b', 'c']);
    expect(next.index).toBe(0);
  });

  it('moves an item already in the list to the front rather than duplicating it', () => {
    const next = recordRecent(list(['a', 'b', 'c']), 'c', equals, 8);
    expect(next.history).toEqual(['c', 'a', 'b']);
  });

  it('drops the oldest entry past the maximum', () => {
    const next = recordRecent(list(['a', 'b']), 'c', equals, 2);
    expect(next.history).toEqual(['c', 'a']);
  });

  it('leaves the list alone when the item is the one the cursor points at', () => {
    // Stepping back to an older entry and using it must not reshuffle the list
    // out from under the stepper, or stepping forward again is impossible.
    const state = list(['a', 'b', 'c'], 2);
    const next = recordRecent(state, 'c', equals, 8);

    expect(next.history).toEqual(['a', 'b', 'c']);
    expect(next.index).toBe(2);
  });

  it('returns the same state object when nothing changes', () => {
    // Not merely equal — the same object, so React treats it as no change and
    // a stroke that keeps using one brush does not re-render per painted cell.
    const state = list(['a', 'b'], 0);
    expect(recordRecent(state, 'a', equals, 8)).toBe(state);
  });

  it('returns a new state object when something does change', () => {
    const state = list(['a', 'b'], 0);
    expect(recordRecent(state, 'z', equals, 8)).not.toBe(state);
  });

  it('records into an empty list', () => {
    const next = recordRecent(list([]), 'a', equals, 8);
    expect(next.history).toEqual(['a']);
    expect(next.index).toBe(0);
  });
});

describe('stepRecent', () => {
  it('moves the cursor and clamps at both ends', () => {
    expect(stepRecent(['a', 'b', 'c'], 0, 1)).toBe(1);
    expect(stepRecent(['a', 'b', 'c'], 0, -1)).toBe(0);
    expect(stepRecent(['a', 'b', 'c'], 2, 1)).toBe(2);
  });

  it('yields 0 for an empty list', () => {
    expect(stepRecent([], 0, 1)).toBe(0);
  });
});
