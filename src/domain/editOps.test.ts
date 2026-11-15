// Feature: the editor's bulk tools, as data.
// Verifies: where pasted text lands, Home/End and word jumps, moving and
// copying a rectangle, and the line, box and fill shapes.

import { describe, expect, it } from 'vitest';

import {
  boxPoints,
  floodPoints,
  layoutText,
  lineEnd,
  linePoints,
  moveRect,
  offsetRect,
  paintPoints,
  rectFromCorners,
  withSixelPart,
  wordJump,
} from './editOps';
import { COLS, createEmptyPage, type Cell, type TeletextPage } from '../types/teletext';

const at = (col: number, row: number) => row * COLS + col;

function pageWith(text: string, col: number, row: number): TeletextPage {
  const page = createEmptyPage();
  [...text].forEach((char, i) => {
    page[at(col + i, row)] = { ...page[at(col + i, row)], char };
  });
  return page;
}

function applied(page: TeletextPage, writes: Map<number, Cell>): TeletextPage {
  const next = [...page];
  for (const [index, cell] of writes) next[index] = cell;
  return next;
}

const rowText = (page: TeletextPage, row: number) =>
  page.slice(row * COLS, (row + 1) * COLS).map((c) => c.char).join('').trimEnd();

describe('layoutText', () => {
  it('returns new lines, and lines too long, to the column it started in', () => {
    const placed = layoutText('ab\r\ncd', at(38, 2));
    expect(placed).toEqual([
      { index: at(38, 2), char: 'a' },
      { index: at(39, 2), char: 'b' },
      { index: at(38, 3), char: 'c' },
      { index: at(39, 3), char: 'd' },
    ]);
    expect(layoutText('abc', at(38, 2)).at(-1)).toEqual({ index: at(38, 3), char: 'c' });
  });

  it('drops what does not fit on the page, and keeps accents whole', () => {
    expect(layoutText('a\nb\nc', at(0, 22)).map((p) => p.char)).toEqual(['a', 'b']);
    expect(layoutText('é', at(0, 1))).toEqual([{ index: at(0, 1), char: 'é' }]);
  });
});

describe('cursor jumps', () => {
  const page = pageWith('ola  mundo', 3, 5);

  it('End stops after the last character of the row', () => {
    expect(lineEnd(page, at(0, 5))).toBe(at(13, 5));
    expect(lineEnd(page, at(7, 6))).toBe(at(0, 6));
  });

  it('jumps a word at a time in both directions', () => {
    expect(wordJump(page, at(3, 5), 1)).toBe(at(8, 5));
    expect(wordJump(page, at(10, 5), -1)).toBe(at(8, 5));
    expect(wordJump(page, at(8, 5), -1)).toBe(at(3, 5));
    expect(wordJump(page, at(0, 1), -1)).toBe(at(0, 1));
  });
});

describe('rectangles', () => {
  it('keeps a selection off the header row and inside the page', () => {
    expect(rectFromCorners(at(5, 0), at(2, 3))).toEqual({ col: 2, row: 1, width: 4, height: 3 });
    const rect = { col: 38, row: 22, width: 2, height: 2 };
    expect(offsetRect(rect, 5, 5)).toEqual(rect);
    expect(offsetRect(rect, -50, -50)).toEqual({ ...rect, col: 0, row: 1 });
  });

  it('moves a block and leaves empty cells behind, or copies it', () => {
    const page = pageWith('abc', 0, 2);
    const from = { col: 0, row: 2, width: 3, height: 1 };
    const to = offsetRect(from, 1, 1);
    const moved = applied(page, moveRect(page, from, to, false));
    expect(rowText(moved, 2)).toBe('');
    expect(rowText(moved, 3)).toBe(' abc');
    const copied = applied(page, moveRect(page, from, to, true));
    expect(rowText(copied, 2)).toBe('abc');
    expect(rowText(copied, 3)).toBe(' abc');
  });

  it('overlapping moves read the block before clearing it', () => {
    const page = pageWith('abc', 0, 2);
    const from = { col: 0, row: 2, width: 3, height: 1 };
    const moved = applied(page, moveRect(page, from, offsetRect(from, 1, 0), false));
    expect(rowText(moved, 2)).toBe(' abc');
  });
});

describe('shapes', () => {
  it('draws a line through every cell between its ends', () => {
    const line = linePoints({ index: at(1, 1), part: 0 }, { index: at(4, 4), part: 0 }, false);
    expect(line.map((p) => p.index)).toEqual([at(1, 1), at(2, 2), at(3, 3), at(4, 4)]);
  });

  it('a pixel line lights both sixths of a cell it crosses', () => {
    const points = linePoints({ index: at(2, 2), part: 0 }, { index: at(3, 2), part: 1 }, true);
    expect(points).toHaveLength(4);
    const writes = paintPoints(createEmptyPage(), points, (cell, part) =>
      withSixelPart(cell, part, 'red', false),
    );
    expect(writes.get(at(2, 2))?.graphics).toBe(writes.get(at(3, 2))?.graphics);
    expect([...writes.keys()]).toEqual([at(2, 2), at(3, 2)]);
  });

  it('a box never reaches the header row', () => {
    const box = boxPoints({ index: at(0, 0), part: 0 }, { index: at(1, 2), part: 0 }, false);
    expect(box.map((p) => p.index)).toEqual([at(0, 1), at(1, 1), at(0, 2), at(1, 2)]);
  });

  it('a fill stops at what looks different', () => {
    // A wall down column 3 of an otherwise empty page.
    let page = createEmptyPage();
    for (let row = 0; row < 24; row += 1) page[at(3, row)] = { ...page[at(3, row)], char: '|' };
    const filled = floodPoints(page, { index: at(0, 5), part: 0 }, false);
    expect(filled).toHaveLength(3 * 23);
    // And a pixel fill treats a letter as a wall too.
    page = createEmptyPage();
    for (let row = 0; row < 24; row += 1) page[at(1, row)] = { ...page[at(1, row)], char: '|' };
    expect(floodPoints(page, { index: at(0, 5), part: 0 }, true)).toHaveLength(2 * 3 * 23);
  });
});
