/**
 * Keeping the identity of cells that did not change.
 *
 * Two things must both hold, and they pull against each other. The page has to
 * be *correct* — reusing a cell that actually changed would show the reader
 * something that is not there. And identity has to be *kept* wherever it can
 * be, because that is the whole reason this exists: `React.memo` on a cell only
 * skips work when the cell prop is the same object.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { reuseUnchangedCells } from './pageReuse';
import { createEmptyPage, type Cell, type TeletextPage } from '../types/teletext';

/** A page whose cells are all distinct objects, as `normalizePage` returns. */
function freshPage(): TeletextPage {
  return createEmptyPage();
}

describe('reuseUnchangedCells', () => {
  it('renders the same page it was given', () => {
    const previous = freshPage();
    const next = freshPage();
    next[500] = { char: 'X', fg: 'red', bg: 'black', graphics: null };

    const result = reuseUnchangedCells(next, previous);
    expect(result.map((c) => c.char)).toEqual(next.map((c) => c.char));
    expect(result.map((c) => c.fg)).toEqual(next.map((c) => c.fg));
  });

  it('keeps every cell that did not change, and only replaces the one that did', () => {
    const previous = freshPage();
    const next = freshPage();
    next[500] = { char: 'X', fg: 'red', bg: 'black', graphics: null };

    const result = reuseUnchangedCells(next, previous);
    const reused = result.filter((cell, i) => cell === previous[i]).length;
    expect(reused).toBe(previous.length - 1);
    expect(result[500]).toBe(next[500]);
  });

  it('returns the very same array when nothing changed at all', () => {
    // This is the common case: someone else edited a different page, so the
    // channel fired and this page is identical. Not even a new array.
    const previous = freshPage();
    expect(reuseUnchangedCells(freshPage(), previous)).toBe(previous);
  });

  it('takes the new page whole when there is nothing to compare with', () => {
    const next = freshPage();
    expect(reuseUnchangedCells(next, null)).toBe(next);
  });

  it('notices a change in any field a reader would see', () => {
    const base: Cell = { char: 'A', fg: 'white', bg: 'black', graphics: null };
    const variants: Cell[] = [
      { ...base, char: 'B' },
      { ...base, fg: 'red' },
      { ...base, bg: 'blue' },
      { ...base, graphics: 63 },
      { ...base, blink: true },
      { ...base, doubleHeight: true },
      {
        ...base,
        graphics: 63,
        graphicsColors: ['red', 'red', 'red', 'red', 'red', 'red'],
      },
    ];

    for (const variant of variants) {
      const previous = freshPage();
      previous[10] = base;
      const next = freshPage();
      next[10] = variant;
      expect(reuseUnchangedCells(next, previous)[10]).toBe(variant);
    }
  });

  it('spots a difference in the sixel colours alone', () => {
    const withColors = (last: Cell['fg']): Cell => ({
      char: ' ',
      fg: 'white',
      bg: 'black',
      graphics: 63,
      graphicsColors: ['red', 'red', 'red', 'red', 'red', last],
    });
    const previous = freshPage();
    previous[7] = withColors('red');
    const next = freshPage();
    next[7] = withColors('cyan');

    expect(reuseUnchangedCells(next, previous)[7]).toBe(next[7]);
  });

  it('never changes what the page says, whatever the pages are', () => {
    const anyCell = fc.record({
      char: fc.constantFrom('A', 'B', ' '),
      fg: fc.constantFrom<Cell['fg']>('white', 'red'),
      bg: fc.constantFrom<Cell['bg']>('black', 'blue'),
      graphics: fc.constantFrom(null, 0, 63),
    });
    const anyPage = fc.array(anyCell, { minLength: 8, maxLength: 8 });

    fc.assert(
      fc.property(anyPage, anyPage, (a, b) => {
        const result = reuseUnchangedCells(b as TeletextPage, a as TeletextPage);
        expect(result).toHaveLength(b.length);
        for (let i = 0; i < b.length; i += 1) {
          expect(result[i].char).toBe(b[i].char);
          expect(result[i].fg).toBe(b[i].fg);
          expect(result[i].bg).toBe(b[i].bg);
          expect(result[i].graphics ?? null).toBe(b[i].graphics ?? null);
        }
      }),
    );
  });
});
