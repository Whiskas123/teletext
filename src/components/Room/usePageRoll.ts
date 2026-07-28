/**
 * usePageRoll — the teletext "rolling digits" transition between pages.
 *
 * When the displayed Page_Number changes, a real teletext set counts through
 * the intervening numbers before settling. This hook reproduces that: the
 * header number counts **up** one page at a time towards the target — always
 * up, wrapping {@link MAX_PAGE} → {@link MIN_PAGE}, the way a set cycling
 * through the carousel does (999 → 120 rolls 999, 100, 101 … 120) — and the
 * page CONTENT is held frozen until the roll lands, so the new page doesn't
 * appear before its number does.
 *
 * While idle (not rolling) the content stays live, so edits made to the page
 * currently on screen show up immediately.
 *
 * Shared by the room viewer and the solo viewer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TeletextPage } from '../../collab/types';

/** Delay between each rolling digit step when the displayed page changes. */
export const PAGE_ROLL_MS = 22;

/** Lowest / highest Page_Number the roll cycles through (teletext pages). */
const MIN_PAGE = 100;
const MAX_PAGE = 999;

/** The next number in the roll: always upwards, wrapping 999 → 100. */
function nextRollStep(current: number): number {
  if (current < MIN_PAGE || current >= MAX_PAGE) return MIN_PAGE;
  return current + 1;
}

export interface PageRoll {
  /** The page number to render in the header — mid-roll this is in transit. */
  displayNumber: number;
  /** The page content to render — held frozen until the roll lands. */
  shownPage: TeletextPage;
}

/**
 * Roll the header towards `targetPageNumber`, revealing `page` on arrival.
 */
export function usePageRoll(
  targetPageNumber: number,
  page: TeletextPage,
): PageRoll {
  const [displayNumber, setDisplayNumberState] = useState(targetPageNumber);
  const [shownPage, setShownPage] = useState(page);
  const displayRef = useRef(targetPageNumber);
  const pageRef = useRef(page);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollingRef = useRef(false);

  const setDisplayNumber = useCallback((n: number) => {
    displayRef.current = n;
    setDisplayNumberState(n);
  }, []);

  const stopRoll = useCallback(() => {
    if (rollTimer.current !== null) {
      clearInterval(rollTimer.current);
      rollTimer.current = null;
    }
  }, []);

  // Roll the header to the target on change; keep content frozen until the roll
  // lands. Declared BEFORE the content-sync effect so it marks the roll in
  // progress first on the render where the target changes.
  useEffect(() => {
    if (displayRef.current === targetPageNumber) return;
    const target = targetPageNumber;
    rollingRef.current = true;
    stopRoll();
    rollTimer.current = setInterval(() => {
      const cur = displayRef.current;
      if (cur === target) {
        stopRoll();
        rollingRef.current = false;
        setShownPage(pageRef.current); // reveal the target page content
        return;
      }
      setDisplayNumber(nextRollStep(cur));
    }, PAGE_ROLL_MS);
  }, [targetPageNumber, stopRoll, setDisplayNumber]);

  // Keep the latest content available to the roll timer, and keep what's shown
  // live while idle (so edits to the watched page appear) — but never mid-roll,
  // where the content stays frozen until the number lands.
  useEffect(() => {
    pageRef.current = page;
    if (!rollingRef.current) setShownPage(page);
  }, [page]);

  useEffect(() => {
    return () => stopRoll();
  }, [stopRoll]);

  return { displayNumber, shownPage };
}
