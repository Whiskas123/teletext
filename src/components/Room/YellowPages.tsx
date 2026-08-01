/**
 * YellowPages — a popup styled like a printed Yellow Pages directory, listing
 * the teletext pages (from {@link useGuide}) so a member can look one up and
 * request it. Selecting a listing routes through the room's vote (via the
 * `onSelect` prop, wired by the viewer), rather than changing the page directly.
 *
 * The visual style deliberately mimics classifieds print: a yellow "book" with
 * a condensed Univers-style typeface and dotted leaders between the listing name
 * and its page number.
 */

import { useEffect } from 'react';

import { useGuide } from '../../collab/useGuide';

export interface YellowPagesProps {
  /** Called with a listing's Page_Number when it is selected (routes to voting). */
  onSelect: (pageNumber: number) => void;
  /** Close the popup. */
  onClose: () => void;
}

/** Format a Page_Number as three digits (e.g. 7 -> "007"). */
function formatPageNumber(n: number): string {
  return String(n).padStart(3, '0');
}

export function YellowPages({ onSelect, onClose }: YellowPagesProps) {
  const { entries } = useGuide();

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="yellow-pages-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Yellow Pages"
      onClick={onClose}
    >
      <div className="yellow-pages-book" onClick={(e) => e.stopPropagation()}>
        <div className="yellow-pages-masthead">
          <span className="yellow-pages-brand">Page Directory</span>
          <button
            type="button"
            className="yellow-pages-close"
            onClick={onClose}
            aria-label="Close Yellow Pages"
          >
            ×
          </button>
        </div>
        <p className="yellow-pages-tagline">
          
        </p>
        <hr className="yellow-pages-rule" />

        {entries.length === 0 ? (
          <p className="yellow-pages-empty">
            No listings yet. Create a page in the editor to have it appear here.
          </p>
        ) : (
          <ul
            className="yellow-pages-list"
            // Explicit row count so `grid-auto-flow: column` fills column 1
            // top-to-bottom then continues into column 2 — the same reading
            // order the old `columns: 2` produced, but as real independently
            // hit-tested grid items (CSS multicol had a rendering bug where
            // hovering the last entry of one column could show the hover
            // state on the DOM-adjacent entry at the top of the next column).
            style={{ gridTemplateRows: `repeat(${Math.max(1, Math.ceil(entries.length / 2))}, auto)` }}
          >
            {entries.map((entry) => (
              <li key={entry.pageNumber} className="yellow-pages-entry">
                <button
                  type="button"
                  className="yellow-pages-entry-btn"
                  onClick={() => {
                    onSelect(entry.pageNumber);
                    onClose();
                  }}
                >
                  <span className="yellow-pages-name">
                    {entry.title.trim().length > 0
                      ? entry.title
                      : 'Untitled listing'}
                  </span>
                  <span className="yellow-pages-leader" aria-hidden="true" />
                  <span className="yellow-pages-number">
                    {formatPageNumber(entry.pageNumber)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="yellow-pages-footnote">Tap a listing to request that page.</p>
      </div>
    </div>
  );
}

export default YellowPages;
