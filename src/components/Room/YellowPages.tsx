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

import { useEffect, useMemo, useRef, useState } from 'react';

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

/** One row of the directory: a listing, and how deep it is filed. */
interface Row {
  node: DirectoryNode;
  depth: number;
}

/**
 * A block of rows that must stay together — a heading and the pages under it.
 *
 * The directory is a tree, and a tree only reads in one order, so it used to be
 * laid out in a single column: splitting a flat run of rows across columns
 * stranded a category's children away from the category. Blocks fix that from
 * the other end. Each heading and its own pages is a self-contained unit, so the
 * units can be placed side by side without any of them being cut in half — and a
 * wide screen stops showing one narrow column with 200 rows in it.
 *
 * A heading nested inside another becomes a block of its own rather than being
 * absorbed, so one enormous category cannot collapse the layout back to a single
 * column.
 */
interface Block {
  key: number;
  rows: Row[];
}

/**
 * Drop consecutive listings that repeat the previous one's name.
 *
 * A teletext article longer than one screen is continued on the next page under
 * the same title, so the corpus is full of runs like NOTÍCIAS 117, NOTÍCIAS 118,
 * NOTÍCIAS 119. Listing each one says nothing the first does not, and pads the
 * directory with rows nobody needs to choose between — the first is where you
 * start reading either way.
 *
 * Only adjacent rows at the same depth are collapsed, and only ordinary pages: a
 * heading that happens to share a name with the listing above it is a different
 * kind of thing and stays.
 */
function collapseRepeats(rows: readonly Row[]): Row[] {
  const kept: Row[] = [];

  for (const row of rows) {
    const previous = kept[kept.length - 1];
    const repeats =
      previous != null &&
      row.node.kind === 'page' &&
      previous.node.kind === 'page' &&
      previous.depth === row.depth &&
      previous.node.title.trim().toLocaleLowerCase() ===
        row.node.title.trim().toLocaleLowerCase();

    if (!repeats) kept.push(row);
  }

  return kept;
}

function directoryBlocks(nodes: readonly DirectoryNode[]): Block[] {
  const blocks: Block[] = [];

  const walk = (list: readonly DirectoryNode[], depth: number): void => {
    /** Consecutive pages filed under no heading, gathered into one block. */
    let loose: Block | null = null;

    for (const node of list) {
      const isHeading = node.kind === 'category' || node.kind === 'subcategory';
      if (!isHeading) {
        if (loose == null) {
          loose = { key: node.pageNumber, rows: [] };
          blocks.push(loose);
        }
        loose.rows.push({ node, depth });
        continue;
      }

      loose = null;
      const rows: Row[] = [{ node, depth }];
      const nested: DirectoryNode[] = [];
      for (const child of node.children) {
        if (child.kind === 'page') rows.push({ node: child, depth: depth + 1 });
        else nested.push(child);
      }
      blocks.push({ key: node.pageNumber, rows });
      walk(nested, depth + 1);
    }
  };

  walk(nodes, 0);
  // Collapsed per block, after the rows are gathered: a run only counts as a run
  // if nothing separates it, and the block is what defines "next to each other".
  return blocks
    .map((block) => ({ ...block, rows: collapseRepeats(block.rows) }))
    .filter((block) => block.rows.length > 0);
}

/** One listing row. */
function Listing({ row, onPick }: { row: Row; onPick: (pageNumber: number) => void }) {
  const { node, depth } = row;
  return (
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
  );
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

  const blocks = useMemo(() => directoryBlocks(tree), [tree]);

  const flowRef = useRef<HTMLDivElement>(null);
  const { sheet, sheets, setSheet } = useSheets(flowRef, blocks);

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
              {blocks.map((block) => (
                <ul key={block.key} className="yellow-pages-list">
                  {block.rows.map((row) => (
                    <Listing
                      key={row.node.pageNumber}
                      row={row}
                      onPick={(pageNumber) => {
                        onSelect(pageNumber);
                        onClose();
                      }}
                    />
                  ))}
                </ul>
              ))}
            </div>
          </div>
        )}

        <p className="yellow-pages-footnote">Tap a listing to request that page.</p>
      </div>
    </div>
  );
}

export default YellowPages;
