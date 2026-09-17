// Feature: teletext page transitions — the rolling header number.
//
// The roll is a deliberate delay, so the thing worth pinning is where it ends:
// a short hop counts every number in between, and a long one counts for
// PAGE_ROLL_MAX_MS and then lands, rather than making the viewer watch eight
// hundred digits go by. The content must never arrive before the number does,
// whichever way the roll finished.

import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePageRoll, PAGE_ROLL_MS, PAGE_ROLL_MAX_MS } from './usePageRoll';
import { createEmptyPage } from '../../types/teletext';
import type { TeletextPage } from '../../collab/types';

/**
 * A page distinguishable from another by its first cell — a page is a flat cell
 * array, so a single character is the whole of the marking a test needs.
 */
function pageMarked(mark: string): TeletextPage {
  const page = createEmptyPage();
  return page.map((cell, i) => (i === 0 ? { ...cell, char: mark } : cell));
}

/** The marking character of whatever page is on the glass. */
function markOf(page: TeletextPage): string {
  return page[0].char;
}

/** Let `n` roll ticks fire. */
function tick(times: number): void {
  act(() => {
    vi.advanceTimersByTime(PAGE_ROLL_MS * times);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePageRoll', () => {
  it('counts through every number of a short hop', () => {
    const from = pageMarked('F');
    const { result, rerender } = renderHook(
      ({ target, page }) => usePageRoll(target, page),
      { initialProps: { target: 120, page: from } },
    );

    const to = pageMarked('T');
    rerender({ target: 123, page: to });

    tick(1);
    expect(result.current.displayNumber).toBe(121);
    tick(1);
    expect(result.current.displayNumber).toBe(122);
    // Still counting, so the old page is still on the glass.
    expect(markOf(result.current.shownPage)).toBe('F');

    tick(2); // reaches 123, then settles on the following tick
    expect(result.current.displayNumber).toBe(123);
    expect(markOf(result.current.shownPage)).toBe('T');
  });

  it('gives up counting after PAGE_ROLL_MAX_MS and lands on the target', () => {
    const from = pageMarked('F');
    const { result, rerender } = renderHook(
      ({ target, page }) => usePageRoll(target, page),
      { initialProps: { target: 100, page: from } },
    );

    // 899 steps at PAGE_ROLL_MS would be ~20 seconds of counting.
    const to = pageMarked('T');
    rerender({ target: 999, page: to });

    // Just short of the cap it is still rolling: nowhere near the target, and
    // still showing the page it left.
    act(() => {
      vi.advanceTimersByTime(PAGE_ROLL_MAX_MS - PAGE_ROLL_MS);
    });
    expect(result.current.displayNumber).toBeGreaterThan(100);
    expect(result.current.displayNumber).toBeLessThan(999);
    expect(markOf(result.current.shownPage)).toBe('F');

    // The first tick past the cap jumps; the next settles and reveals.
    tick(3);
    expect(result.current.displayNumber).toBe(999);
    expect(markOf(result.current.shownPage)).toBe('T');
  });

  it('skipRoll goes straight there without waiting for the cap', () => {
    const from = pageMarked('F');
    const { result, rerender } = renderHook(
      ({ target, page }) => usePageRoll(target, page),
      { initialProps: { target: 500, page: from } },
    );

    act(() => {
      result.current.skipRoll();
    });
    const to = pageMarked('T');
    rerender({ target: 499, page: to });

    tick(2);
    expect(result.current.displayNumber).toBe(499);
    expect(markOf(result.current.shownPage)).toBe('T');
  });
});
