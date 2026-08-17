/**
 * The grid renders row by row, and a double-height cell crosses that boundary.
 *
 * Rows are a memo boundary (see `sameRow` in `TeletextGrid.tsx`) so that a
 * keystroke reconciles forty cells rather than nine hundred and sixty. The one
 * thing a row boundary could break is the only piece of the grid that is not
 * contained within a row: a double-height cell's box spans down into the row
 * below, and the cell it covers there has to render nothing. That is a fact
 * about two rows, decided in the lower one, so it is what these tests hold.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TeletextGrid } from './TeletextGrid';
import { COLS, ROWS, createEmptyPage, indexAt } from '../../types/teletext';

/** Every rendered cell, in document order. */
function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.teletext-cell')];
}

describe('the grid as rows', () => {
  it('renders every cell of a plain page, in order', () => {
    const { container } = render(<TeletextGrid page={createEmptyPage()} />);
    expect(cells(container)).toHaveLength(ROWS * COLS);
  });

  it('places cells by explicit row and column, so the wrapper cannot move them', () => {
    // The row element is `display: contents` and places nothing itself; every
    // cell carries its own coordinates. If that ever stopped being true the
    // grid would collapse into a single column.
    const { container } = render(<TeletextGrid page={createEmptyPage()} />);
    const all = cells(container);

    expect(all[0].style.gridColumn).toBe('1');
    expect(all[0].style.gridRow).toBe('1');
    // First cell of the third row.
    expect(all[COLS * 2].style.gridColumn).toBe('1');
    expect(all[COLS * 2].style.gridRow).toBe('3');
    // Last cell of the third row.
    expect(all[COLS * 3 - 1].style.gridColumn).toBe('40');
    expect(all[COLS * 3 - 1].style.gridRow).toBe('3');
  });

  it('spans a double-height cell over the row below and hides what it covers', () => {
    const page = createEmptyPage();
    const index = indexAt(5, 3);
    page[index] = { char: 'A', fg: 'white', bg: 'black', graphics: null, doubleHeight: true };
    page[index + COLS] = { char: 'B', fg: 'white', bg: 'black', graphics: null };

    const { container } = render(<TeletextGrid page={page} />);
    const all = cells(container);

    // One cell short: the covered one renders nothing at all.
    expect(all).toHaveLength(ROWS * COLS - 1);

    // Selected by class, not by its character: the header's clock puts an 'A'
    // on the page too, every August.
    const tall = container.querySelectorAll<HTMLElement>('.teletext-cell-double-height');
    expect(tall).toHaveLength(1);
    expect(tall[0].textContent).toBe('A');
    expect(tall[0].style.gridRow).toBe('4 / span 2');
    // And the character it covers is nowhere on the page.
    expect(all.some((cell) => cell.textContent === 'B')).toBe(false);
  });

  it('brings the covered cell back when the one above stops being tall', () => {
    // The decision lives in the lower row but depends on the upper one, so this
    // is the update a row-level memo has to notice.
    const page = createEmptyPage();
    const index = indexAt(5, 3);
    page[index] = { char: 'A', fg: 'white', bg: 'black', graphics: null, doubleHeight: true };
    page[index + COLS] = { char: 'B', fg: 'white', bg: 'black', graphics: null };

    const { container, rerender } = render(<TeletextGrid page={page} />);
    expect(cells(container).some((cell) => cell.textContent === 'B')).toBe(false);

    const shortened = page.slice();
    shortened[index] = { ...page[index], doubleHeight: false };
    rerender(<TeletextGrid page={shortened} />);

    const all = cells(container);
    expect(all).toHaveLength(ROWS * COLS);
    expect(all.some((cell) => cell.textContent === 'B')).toBe(true);
  });

  it('moves the cursor outline when the cursor moves between rows', () => {
    // The cursor is passed to one row at a time, so the row it left has to be
    // told as well as the row it arrived at.
    const page = createEmptyPage();
    const { container, rerender } = render(
      <TeletextGrid page={page} cursorIndex={indexAt(2, 1)} />,
    );

    const cursorColumn = () =>
      container.querySelector<HTMLElement>('.teletext-cell.cursor')?.style.gridRow;

    expect(cursorColumn()).toBe('2');

    rerender(<TeletextGrid page={page} cursorIndex={indexAt(2, 9)} />);
    expect(container.querySelectorAll('.teletext-cell.cursor')).toHaveLength(1);
    expect(cursorColumn()).toBe('10');
  });
});
