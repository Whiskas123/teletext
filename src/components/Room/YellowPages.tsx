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

import { useEffect, useMemo } from 'react';

import { useGuide } from '../../collab/useGuide';
import { usePageKinds } from '../../collab/usePageKinds';
import { buildDirectory, type DirectoryNode } from '../../domain/directory';

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

/**
 * One listing and everything filed beneath it.
 *
 * Depth is passed down rather than derived from nesting the lists, because the
 * directory is laid out in two columns that flow top-to-bottom: a nested `<ul>`
 * would be one grid item and could not break across them. Indenting a flat run
 * of rows keeps the reading order and the column flow intact.
 */
function Listing({
  node,
  depth,
  onPick,
}: {
  node: DirectoryNode;
  depth: number;
  onPick: (pageNumber: number) => void;
}) {
  const heading = node.kind === 'category' || node.kind === 'subcategory';
  return (
    <>
      <li
        className={`yellow-pages-entry yellow-pages-entry-${node.kind}`}
        style={depth > 0 ? { paddingLeft: `${depth * 0.9}rem` } : undefined}
      >
        <button
          type="button"
          className="yellow-pages-entry-btn"
          onClick={() => onPick(node.pageNumber)}
        >
          <span className="yellow-pages-name">
            {node.title.trim().length > 0 ? node.title : 'Untitled listing'}
          </span>
          <span className="yellow-pages-leader" aria-hidden="true" />
          <span className="yellow-pages-number">
            {formatPageNumber(node.pageNumber)}
          </span>
        </button>
      </li>
      {heading &&
        node.children.map((child) => (
          <Listing key={child.pageNumber} node={child} depth={depth + 1} onPick={onPick} />
        ))}
    </>
  );
}

export function YellowPages({ onSelect, onClose }: YellowPagesProps) {
  const { entries } = useGuide();
  const { kinds } = usePageKinds();

  // The directory's shape is read off page order and each page's kind, so it
  // needs no structure of its own — see `domain/directory.ts`.
  const tree = useMemo(
    () =>
      buildDirectory(
        entries.map((entry) => ({
          pageNumber: entry.pageNumber,
          title: entry.title,
          kind: kinds[entry.pageNumber],
        })),
      ),
    [entries, kinds],
  );

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
      /*
       * Not `aria-modal`: the object bar stays above this backdrop and stays
       * usable, so claiming everything outside is inert would be untrue — and
       * it is deliberate. The yellow book icon is what opens the directory, so
       * it has to remain clickable to close it again.
       */
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
            {tree.map((node) => (
              <Listing
                key={node.pageNumber}
                node={node}
                depth={0}
                onPick={(pageNumber) => {
                  onSelect(pageNumber);
                  onClose();
                }}
              />
            ))}
          </ul>
        )}

        <p className="yellow-pages-footnote">Tap a listing to request that page.</p>
      </div>
    </div>
  );
}

export default YellowPages;
