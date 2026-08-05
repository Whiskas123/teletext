/**
 * The subpage counter in the page header.
 *
 * A broadcast header carried `X/Y` beside the page number, and it is the only
 * thing on screen that says a page has more to it than what is showing —
 * without it the subpage arrows look like controls that sometimes do nothing.
 * It is drawn into the header row's cells rather than added as chrome, so it
 * lives inside the 40x24 grid like everything else and survives an export.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TeletextGrid } from './TeletextGrid';
import { COLS, createEmptyPage } from '../../types/teletext';

/**
 * The header row as one string.
 *
 * The grid renders a blank cell as U+00A0 so the cell keeps its height. Written
 * as an escape rather than a literal: a non-breaking space in the source is
 * indistinguishable from an ordinary one at a glance.
 */
function headerText(container: HTMLElement): string {
  const cells = [...container.querySelectorAll('.teletext-cell')].slice(0, COLS);
  return cells
    .map((cell) => cell.textContent ?? '')
    .join('')
    .replace(/\u00a0/g, ' ');
}

describe('the header subpage counter', () => {
  it('shows 1/1 on a page with no carousel', () => {
    // Always shown, never hidden on a single-screen page: a counter that comes
    // and goes as you change page reads as a glitch, not as information.
    const { container } = render(
      <TeletextGrid page={createEmptyPage()} pageNumber={220} readOnly />,
    );
    expect(headerText(container)).toMatch(/^220 1\/1/);
  });

  it('shows which screen of the carousel is on', () => {
    const { container } = render(
      <TeletextGrid
        page={createEmptyPage()}
        pageNumber={220}
        subpage={2}
        subpageCount={3}
        readOnly
      />,
    );
    expect(headerText(container)).toMatch(/^220 2\/3/);
  });

  it('sits clear of the clock', () => {
    // The counter starts at column 4 and the date and time at column 20. At its
    // widest it reaches column 8, so the two can never collide — but only as
    // long as nothing widens either of them.
    const { container } = render(
      <TeletextGrid
        page={createEmptyPage()}
        pageNumber={999}
        subpage={26}
        subpageCount={26}
        readOnly
      />,
    );
    const header = headerText(container);
    expect(header.slice(0, 20)).toBe('999 26/26           ');
  });

  it('never claims a screen the page does not have', () => {
    // The count is shared state, so a page can lose a screen while it is being
    // watched. Clamped rather than rendered as-is, which would read `3/2`.
    const { container } = render(
      <TeletextGrid
        page={createEmptyPage()}
        pageNumber={220}
        subpage={3}
        subpageCount={2}
        readOnly
      />,
    );
    expect(headerText(container)).toMatch(/^220 2\/2/);
  });
});
