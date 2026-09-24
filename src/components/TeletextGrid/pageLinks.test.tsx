/**
 * A three-digit number on a read-only page is a link to that page.
 *
 * To the page it names, not the section it falls in: `234` leads to 234. It
 * once rounded to the nearest hundred, so `234` went to 200, `251` to 300 and
 * anything from 950 up was not a link at all.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { TeletextGrid } from './TeletextGrid';
import { COLS, createEmptyPage, indexAt } from '../../types/teletext';

function pageWithText(row: number, col: number, text: string) {
  const page = createEmptyPage();
  [...text].forEach((char, i) => {
    page[indexAt(col + i, row)] = { ...page[indexAt(col + i, row)], char };
  });
  return page;
}

function renderLinks(text: string) {
  const onSelect = vi.fn();
  const { container } = render(
    <TeletextGrid page={pageWithText(5, 2, text)} readOnly onIndexPageSelect={onSelect} />,
  );
  const cellAt = (col: number) =>
    container.querySelectorAll<HTMLElement>('.teletext-cell')[5 * COLS + 2 + col];
  return { onSelect, cellAt };
}

describe('page number links', () => {
  it.each([
    ['234', 234],
    ['251', 251],
    ['101', 101],
    ['999', 999],
  ])('%s leads to page %i from any of its digits', (text, target) => {
    const { onSelect, cellAt } = renderLinks(text);
    for (const col of [0, 1, 2]) {
      expect(cellAt(col).classList).toContain('teletext-index-link');
      fireEvent.click(cellAt(col));
    }
    expect(onSelect.mock.calls).toEqual([[target], [target], [target]]);
  });

  it('links each number in a line of several', () => {
    const { onSelect, cellAt } = renderLinks('Sport 302 News 115');
    fireEvent.click(cellAt(6));
    fireEvent.click(cellAt(17));
    expect(onSelect.mock.calls).toEqual([[302], [115]]);
  });

  it.each(['1998', '12345', '099', '42'])('does not link %s', (text) => {
    const { onSelect, cellAt } = renderLinks(text);
    for (let col = 0; col < text.length; col++) {
      expect(cellAt(col).classList).not.toContain('teletext-index-link');
      fireEvent.click(cellAt(col));
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});
