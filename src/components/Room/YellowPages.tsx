/**
 * YellowPages — a popup styled like a printed Yellow Pages directory, listing
 * the teletext pages (from {@link useGuide}) so a member can look one up and
 * request it. Selecting a listing routes through the room's vote (via the
 * `onSelect` prop, wired by the viewer), rather than changing the page directly.
 *
 * The visual style deliberately mimics classifieds print: a yellow "book" with
 * a condensed Univers-style typeface and dotted leaders between the listing name
 * and its page number.
 *
 * The rows themselves — and the tree they are read off — live in
 * {@link DirectoryList}, because the solo viewer's drawer lists the same
 * directory down the side of the television. What is here is the book: columns
 * filled top to bottom, and sheets turned when they run past one screen.
 */

import { useEffect, useRef, useState } from 'react';

import DirectoryList from './DirectoryList';
import { useDirectory, useOpenSections } from './directoryRows';

export interface YellowPagesProps {
  /** Called with a listing's Page_Number when it is selected (routes to voting). */
  onSelect: (pageNumber: number) => void;
  /** Close the popup. */
  onClose: () => void;
}

/**
 * How many sheets the columns spill across, and which one is showing.
 *
 * The listings flow into columns of a fixed width, filling each one top to bottom
 * before starting the next, and a directory longer than the screen simply makes
 * more columns than fit. Rather than scroll sideways, the flow is shifted a whole
 * screen at a time — a page of a phone book, turned.
 *
 * The shift is `100% + gap` per sheet, not `100%`: the column pitch includes the
 * gap, while the box width counts one fewer gap than columns, so shifting by the
 * width alone would drift by a gap every sheet.
 */
function useSheets(flow: React.RefObject<HTMLDivElement | null>, deps: unknown) {
  const [sheet, setSheet] = useState(0);
  const [sheets, setSheets] = useState(1);

  useEffect(() => {
    const element = flow.current;
    if (element == null) return;

    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const visible = element.clientWidth + gap;
      const total = element.scrollWidth + gap;
      const count = visible > 0 ? Math.max(1, Math.round(total / visible)) : 1;
      setSheets(count);
      setSheet((current) => Math.min(current, count - 1));
    };

    // After layout rather than during the effect, so the measurement sees the
    // columns the browser actually produced.
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [flow, deps]);

  return { sheet, sheets, setSheet };
}

export function YellowPages({ onSelect, onClose }: YellowPagesProps) {
  const { entries, blocks, counts } = useDirectory();
  const { openSections, toggleSection } = useOpenSections();

  const flowRef = useRef<HTMLDivElement>(null);
  // Opening a section changes how many columns the flow needs, so the sheet
  // count is measured again — not just when the directory itself changes.
  const { sheet, sheets, setSheet } = useSheets(
    flowRef,
    `${blocks.length}:${openSections.size}`,
  );

  // Escape closes; the arrows turn the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowRight') setSheet((s) => Math.min(s + 1, sheets - 1));
      if (e.key === 'ArrowLeft') setSheet((s) => Math.max(s - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, setSheet, sheets]);

  const pick = (pageNumber: number) => {
    onSelect(pageNumber);
    onClose();
  };

  return (
    <div
      className="yellow-pages-overlay"
      role="dialog"
      /*
       * Not `aria-modal`: the object bar stays above this backdrop and stays
       * usable, so claiming everything outside is inert would be untrue — and
       * it is deliberate. The yellow book icon is what opens the directory, so
       * it has to remain clickable to close it again.
       */
      aria-label="Yellow Pages"
      onClick={onClose}
    >
      <div
        className="yellow-pages-book yellow-pages-book-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="yellow-pages-masthead">
          <span className="yellow-pages-brand">Page Directory</span>
          {sheets > 1 && (
            <div className="yellow-pages-pager">
              <button
                type="button"
                className="yellow-pages-turn"
                aria-label="Previous sheet"
                disabled={sheet === 0}
                onClick={() => setSheet((s) => Math.max(s - 1, 0))}
              >
                ‹
              </button>
              <span className="yellow-pages-sheet-count" aria-live="polite">
                Sheet {sheet + 1} of {sheets}
              </span>
              <button
                type="button"
                className="yellow-pages-turn"
                aria-label="Next sheet"
                disabled={sheet === sheets - 1}
                onClick={() => setSheet((s) => Math.min(s + 1, sheets - 1))}
              >
                ›
              </button>
            </div>
          )}
          <button
            type="button"
            className="yellow-pages-close"
            onClick={onClose}
            aria-label="Close Yellow Pages"
          >
            ×
          </button>
        </div>
        <hr className="yellow-pages-rule" />

        {entries.length === 0 ? (
          <p className="yellow-pages-empty">
            No listings yet. Create a page in the editor to have it appear here.
          </p>
        ) : (
          <div className="yellow-pages-viewport">
            {/*
              * Multi-column, filling each column to the bottom before starting the
              * next — so it reads down and then across, the way a directory does.
              * Each block is `break-inside: avoid`, so a heading is never parted
              * from the pages under it.
              */}
            <div
              className="yellow-pages-flow"
              ref={flowRef}
              style={{ transform: `translateX(calc(${-sheet} * (100% + var(--yp-gap))))` }}
            >
              <DirectoryList
                blocks={blocks}
                counts={counts}
                openSections={openSections}
                onToggleSection={toggleSection}
                onPick={pick}
              />
            </div>
          </div>
        )}

        <p className="yellow-pages-footnote">Tap a listing to request that page.</p>
      </div>
    </div>
  );
}

export default YellowPages;
