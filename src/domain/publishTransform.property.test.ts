/**
 * Tests for the transforms applied when publishing: the row shift, the custom
 * menu strip, and the thumbnail reduction.
 *
 * These decide what actually lands on a page, so the properties that matter are
 * about not losing or inventing content: a shift moves rows and drops exactly
 * one, a menu replaces exactly one row, and a thumbnail is always the same
 * length whatever it is handed.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_MENU_LABEL,
  MENU_COLORS,
  MENU_ROW,
  MENU_SLOTS,
  applyMenu,
  emptyMenuDraft,
  menuLayout,
  menuTargets,
  renderMenuRow,
  validateMenu,
} from './menu';
import { lastRowHasContent, shiftPageDown } from './pageTransform';
import { decodeThumbnail, encodeThumbnail, isThumbnail } from './thumbnail';
import {
  COLS,
  ROWS,
  TELETEXT_COLORS,
  TOTAL_CELLS,
  createEmptyPage,
  type Cell,
} from '../types/teletext';

const arbColor = fc.constantFrom(...TELETEXT_COLORS);
const arbCell: fc.Arbitrary<Cell> = fc.record({
  char: fc.constantFrom(' ', 'A', 'z', '7', 'É'),
  fg: arbColor,
  bg: arbColor,
  graphics: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
});
const arbPage = fc.array(arbCell, { minLength: TOTAL_CELLS, maxLength: TOTAL_CELLS });

describe('shiftPageDown', () => {
  it('moves every row down one and blanks the top', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const shifted = shiftPageDown(page);
        for (let row = 0; row < ROWS - 1; row += 1) {
          for (let col = 0; col < COLS; col += 1) {
            expect(shifted[(row + 1) * COLS + col]).toEqual(page[row * COLS + col]);
          }
        }
        for (let col = 0; col < COLS; col += 1) {
          expect(shifted[col].char).toBe(' ');
          expect(shifted[col].graphics).toBeNull();
        }
      }),
    );
  });

  it('always returns a complete page', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        expect(shiftPageDown(page)).toHaveLength(TOTAL_CELLS);
      }),
    );
  });

  it('drops exactly the last row', () => {
    // The point of the transform: a duplicate menu strip on the bottom row is
    // meant to fall off. Losing it is the feature, so it is asserted, not
    // merely tolerated.
    const page = createEmptyPage();
    page[(ROWS - 1) * COLS] = { char: 'X', fg: 'white', bg: 'black', graphics: null };
    const shifted = shiftPageDown(page);
    expect(shifted.some((cell) => cell.char === 'X')).toBe(false);
  });

  it('does not alias the source page', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const shifted = shiftPageDown(page);
        shifted[COLS].char = '@';
        expect(page[0].char).not.toBe('@');
      }),
    );
  });

  it('reports whether the last row would lose anything', () => {
    expect(lastRowHasContent(createEmptyPage())).toBe(false);
    const page = createEmptyPage();
    page[TOTAL_CELLS - 1] = { char: 'Z', fg: 'white', bg: 'black', graphics: null };
    expect(lastRowHasContent(page)).toBe(true);
  });
});

describe('menu validation', () => {
  it('rejects an unnamed menu', () => {
    const result = validateMenu({ name: '   ', items: [] });
    expect(result.ok).toBe(false);
  });

  it('pads a short list out to a full strip', () => {
    const result = validateMenu({ name: 'Main', items: [{ label: 'NEWS', pageNumber: 200 }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(MENU_SLOTS);
      expect(result.value.items[3]).toEqual({ label: '', pageNumber: null });
    }
  });

  it('upper-cases and trims labels', () => {
    const result = validateMenu({ name: 'M', items: [{ label: '  news  ', pageNumber: 200 }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0].label).toBe('NEWS');
  });

  it('rejects a label longer than the slot can show', () => {
    const result = validateMenu({
      name: 'M',
      items: [{ label: 'A'.repeat(MAX_MENU_LABEL + 1), pageNumber: null }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('label-too-long');
  });

  it('rejects a link outside the page range', () => {
    for (const pageNumber of [0, 99, 1000, -5]) {
      const result = validateMenu({ name: 'M', items: [{ label: 'X', pageNumber }] });
      expect(result.ok).toBe(false);
    }
  });

  it('treats a blank page number as no link rather than an error', () => {
    const result = validateMenu({ name: 'M', items: [{ label: 'X', pageNumber: '' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0].pageNumber).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (name, items) => {
        expect(() => validateMenu({ name, items })).not.toThrow();
      }),
    );
  });
});

describe('menu rendering', () => {
  it('gives every slot a distinct colour, left to right', () => {
    const row = renderMenuRow({
      items: MENU_COLORS.map((_, i) => ({ label: `L${i}`, pageNumber: 200 })),
    });
    const layout = menuLayout();
    for (const [slot, color] of MENU_COLORS.entries()) {
      expect(row[layout[slot].start].fg).toBe(color);
    }
  });

  it('leaves an empty slot blank rather than colouring it', () => {
    const row = renderMenuRow({
      items: [{ label: '', pageNumber: null }, ...emptyMenuDraft().items.slice(1)],
    });
    expect(row.every((cell) => cell.char === ' ')).toBe(true);
  });

  it('never writes past the row', () => {
    const row = renderMenuRow({
      items: MENU_COLORS.map(() => ({ label: 'X'.repeat(20), pageNumber: null })),
    });
    expect(row).toHaveLength(COLS);
  });

  it('replaces exactly the last row and touches nothing else', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const applied = applyMenu(page, {
          items: [{ label: 'NEWS', pageNumber: 200 }, ...emptyMenuDraft().items.slice(1)],
        });
        for (let i = 0; i < MENU_ROW * COLS; i += 1) {
          expect(applied[i]).toEqual(page[i]);
        }
        expect(applied).toHaveLength(TOTAL_CELLS);
      }),
    );
  });

  it('lists the pages a menu links to', () => {
    expect(
      menuTargets({
        items: [
          { label: 'A', pageNumber: 200 },
          { label: 'B', pageNumber: null },
          { label: 'C', pageNumber: 300 },
          { label: '', pageNumber: null },
        ],
      }),
    ).toEqual([200, 300]);
  });
});

describe('thumbnails', () => {
  it('is always exactly one digit per cell', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbPage, fc.constant(undefined), fc.constant(null), fc.constant({})),
        (page) => {
          const thumb = encodeThumbnail(page);
          expect(thumb).toHaveLength(TOTAL_CELLS);
          expect(isThumbnail(thumb)).toBe(true);
        },
      ),
    );
  });

  it('round-trips to palette indices', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const decoded = decodeThumbnail(encodeThumbnail(page));
        expect(decoded).not.toBeNull();
        expect(decoded).toHaveLength(TOTAL_CELLS);
        expect([...(decoded ?? [])].every((i) => i >= 0 && i < TELETEXT_COLORS.length)).toBe(true);
      }),
    );
  });

  it('takes a text cell’s foreground and a blank cell’s background', () => {
    const page = createEmptyPage();
    page[0] = { char: 'A', fg: 'yellow', bg: 'blue', graphics: null };
    page[1] = { char: ' ', fg: 'yellow', bg: 'blue', graphics: null };
    const thumb = encodeThumbnail(page);
    expect(thumb[0]).toBe(String(TELETEXT_COLORS.indexOf('yellow')));
    expect(thumb[1]).toBe(String(TELETEXT_COLORS.indexOf('blue')));
  });

  it('refuses anything that is not a thumbnail', () => {
    expect(decodeThumbnail('')).toBeNull();
    expect(decodeThumbnail('9'.repeat(TOTAL_CELLS))).toBeNull();
    expect(decodeThumbnail('0'.repeat(TOTAL_CELLS - 1))).toBeNull();
    expect(decodeThumbnail(null)).toBeNull();
  });
});
