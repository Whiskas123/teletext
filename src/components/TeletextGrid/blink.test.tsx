/**
 * Blinking cells, and the one clock they all obey.
 *
 * `utils/blinkClock.test.ts` covers the clock itself. This covers the wiring:
 * that a grid on screen starts it, that a cell asks to blink by carrying the
 * class rather than by holding a phase of its own — which is what makes two
 * cells painted seconds apart blink together — and that the clock stops when
 * there is no longer any teletext to blink.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { TeletextGrid } from './TeletextGrid';
import { BLINK_OFF_CLASS, BLINK_PERIOD_MS } from '../../utils/blinkClock';
import { COLS, createEmptyPage, indexAt, type TeletextPage } from '../../types/teletext';

/** A page with a blinking `char` at `index`. */
function blinkingAt(page: TeletextPage, index: number, char: string): TeletextPage {
  const next = page.slice();
  next[index] = { char, fg: 'white', bg: 'black', graphics: null, blink: true };
  return next;
}

function blinkingCells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.teletext-cell.teletext-blink')];
}

describe('blinking', () => {
  it('marks a blinking cell, and only that cell', () => {
    const page = blinkingAt(createEmptyPage(), indexAt(3, 4), 'A');
    const { container } = render(<TeletextGrid page={page} />);

    const blinking = blinkingCells(container);
    expect(blinking).toHaveLength(1);
    expect(blinking[0].textContent).toBe('A');
  });

  it('gives a blinking cell no phase of its own', () => {
    // The whole fix: a cell says *that* it blinks and nothing about *when*.
    // An inline animation or delay here would be a cell keeping its own time,
    // which is what made cells painted at different moments fall out of step.
    const page = blinkingAt(createEmptyPage(), indexAt(3, 4), 'A');
    const { container } = render(<TeletextGrid page={page} />);

    const cell = blinkingCells(container)[0];
    expect(cell.style.animation).toBe('');
    expect(cell.style.animationDelay).toBe('');
    expect(cell.style.opacity).toBe('');
  });

  it('marks cells that started blinking at different times identically', () => {
    // Two cells painted a while apart carry exactly the same thing, so there is
    // nothing left that could distinguish their phases.
    const first = blinkingAt(createEmptyPage(), indexAt(3, 4), 'A');
    const { container, rerender } = render(<TeletextGrid page={first} />);
    expect(blinkingCells(container)).toHaveLength(1);

    const second = blinkingAt(first, indexAt(9, 12), 'B');
    rerender(<TeletextGrid page={second} />);

    const blinking = blinkingCells(container);
    expect(blinking).toHaveLength(2);
    expect(blinking[0].className).toBe(blinking[1].className);
  });

  it('runs the shared clock while a grid is on screen and stops after it', () => {
    vi.useFakeTimers();
    try {
      // An exact cycle boundary, so the run starts in the lit half.
      vi.setSystemTime(BLINK_PERIOD_MS * 1000);
      const { unmount } = render(<TeletextGrid page={createEmptyPage()} />);

      const isOff = () => document.documentElement.classList.contains(BLINK_OFF_CLASS);
      expect(isOff()).toBe(false);

      vi.advanceTimersByTime(BLINK_PERIOD_MS / 2);
      expect(isOff()).toBe(true);

      unmount();
      // No teletext left on screen: no timer, and nothing left hidden.
      expect(isOff()).toBe(false);
      vi.advanceTimersByTime(BLINK_PERIOD_MS * 3);
      expect(isOff()).toBe(false);
    } finally {
      vi.useRealTimers();
      document.documentElement.classList.remove(BLINK_OFF_CLASS);
    }
  });

  it('never blinks the header, whatever the page underneath says', () => {
    // The header is drawn over row 0, so a blink stored there would otherwise
    // flash the page number and clock.
    const page = blinkingAt(createEmptyPage(), 1, 'A');
    const { container } = render(<TeletextGrid page={page} pageNumber={220} readOnly />);

    const blinking = blinkingCells(container);
    const headerCells = [...container.querySelectorAll('.teletext-cell')].slice(0, COLS);
    expect(blinking.some((cell) => headerCells.includes(cell))).toBe(false);
  });
});
