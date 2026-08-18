/**
 * How a tree of pages becomes the rows of a printed directory.
 *
 * The listing is the same object wherever it appears — the room's full-screen
 * {@link YellowPages} book, and the leaflet that pulls out beside the television
 * when watching solo — so the shape of it lives here and the containers own
 * nothing but their own layout. What draws a row is {@link DirectoryList}.
 */

import { useMemo, useState } from 'react';

import { useGuide } from '../../collab/useGuide';
import { usePageKinds } from '../../collab/usePageKinds';
import {
  buildDirectory,
  isHeadingKind,
  type DirectoryNode,
} from '../../domain/directory';

/** Format a Page_Number as three digits (e.g. 7 -> "007"). */
export function formatPageNumber(n: number): string {
  return String(n).padStart(3, '0');
}

/** The listing's name, or a stand-in when it has none. */
export function titleOf(node: DirectoryNode): string {
  return node.title.trim().length > 0 ? node.title : 'Untitled listing';
}

/** One row of the directory: a listing, and how deep it is filed. */
export interface Row {
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
export interface Block {
  key: number;
  rows: Row[];
  /**
   * The headings this block is filed under, outermost first.
   *
   * A nested heading becomes a block of its own (see above), which means a
   * category's subcategories are *siblings* of its block rather than rows in
   * it. Collapsing therefore cannot work off a block's own rows alone: closing
   * a category has to take away the blocks descended from it too, and this is
   * the only record of that descent once the tree has been flattened.
   */
  ancestors: number[];
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
      !isHeadingKind(row.node.kind) &&
      !isHeadingKind(previous.node.kind) &&
      previous.depth === row.depth &&
      previous.node.title.trim().toLocaleLowerCase() ===
        row.node.title.trim().toLocaleLowerCase();

    if (!repeats) kept.push(row);
  }

  return kept;
}

export function directoryBlocks(nodes: readonly DirectoryNode[]): Block[] {
  const blocks: Block[] = [];

  const walk = (
    list: readonly DirectoryNode[],
    depth: number,
    ancestors: number[],
  ): void => {
    /** Consecutive pages filed under no heading, gathered into one block. */
    let loose: Block | null = null;

    for (const node of list) {
      if (!isHeadingKind(node.kind)) {
        if (loose == null) {
          loose = { key: node.pageNumber, rows: [], ancestors };
          blocks.push(loose);
        }
        loose.rows.push({ node, depth });
        continue;
      }

      loose = null;
      const rows: Row[] = [{ node, depth }];
      const nested: DirectoryNode[] = [];
      for (const child of node.children) {
        // A nested heading becomes a block of its own; only plain listings are
        // absorbed, so one enormous section cannot collapse the columns.
        if (isHeadingKind(child.kind)) nested.push(child);
        else rows.push({ node: child, depth: depth + 1 });
      }
      blocks.push({ key: node.pageNumber, rows, ancestors });
      walk(nested, depth + 1, [...ancestors, node.pageNumber]);
    }
  };

  walk(nodes, 0, []);
  // Collapsed per block, after the rows are gathered: a run only counts as a run
  // if nothing separates it, and the block is what defines "next to each other".
  return blocks
    .map((block) => ({ ...block, rows: collapseRepeats(block.rows) }))
    .filter((block) => block.rows.length > 0);
}

/**
 * How many listings sit beneath each heading, counting all the way down.
 *
 * Not just the heading's own block: a category holding three subcategories has
 * nothing in its block but itself, and reporting `0` there would be both a lie
 * and the reason its toggle looked broken. Everything descended from the
 * heading counts, nested headings included — they are lines in the directory
 * too.
 */
export function descendantCounts(blocks: readonly Block[]): Map<number, number> {
  const counts = new Map<number, number>();

  const add = (pageNumber: number, n: number) =>
    counts.set(pageNumber, (counts.get(pageNumber) ?? 0) + n);

  for (const block of blocks) {
    const [first, ...rest] = block.rows;
    const heading = isHeadingKind(first.node.kind) ? first : null;

    // The block's own listings belong to the heading it starts with…
    if (heading != null) add(heading.node.pageNumber, rest.length);
    // …and every row of it, heading included, belongs to each heading above.
    for (const ancestor of block.ancestors) add(ancestor, block.rows.length);
  }

  return counts;
}

/**
 * The directory as the guide currently reports it: its blocks and their counts.
 *
 * The shape is read off page order and each page's kind, so it needs no
 * structure of its own — see `domain/directory.ts`.
 */
export function useDirectory() {
  const { entries } = useGuide();
  const { kinds } = usePageKinds();

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
  const counts = useMemo(() => descendantCounts(blocks), [blocks]);

  return { entries, blocks, counts };
}

/**
 * Which sections are open, by their heading's page number.
 *
 * Closed is the default and the set holds the exceptions, so a directory that
 * grows a section does not quietly open it. Closed by default is the point:
 * the archive runs to hundreds of pages, and a directory that opens showing
 * all of them is a wall to scroll rather than an index to read — headings
 * first, then the pages under the one you chose.
 */
export function useOpenSections() {
  const [openSections, setOpenSections] = useState<ReadonlySet<number>>(new Set());

  const toggleSection = (pageNumber: number) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (!next.delete(pageNumber)) next.add(pageNumber);
      return next;
    });
  };

  return { openSections, toggleSection };
}
