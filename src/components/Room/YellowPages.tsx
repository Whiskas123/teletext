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
  return blocks;
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
          // Columns of whole blocks. Grid rather than multicol so each entry is
          // its own hit-tested box and no heading is ever cut in half — see
          // `directoryBlocks` above and `.yellow-pages-columns` in App.css.
          <div className="yellow-pages-columns">
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
        )}

        <p className="yellow-pages-footnote">Tap a listing to request that page.</p>
      </div>
    </div>
  );
}

export default YellowPages;
