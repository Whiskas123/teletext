/**
 * The page directory's rows, as printed.
 *
 * One row is one listing: a name, dotted leaders, and the page it is filed at.
 * The blocks they are gathered into — and the tree those are read off — live in
 * {@link directoryRows}, because the same listing is shown by the room's
 * full-screen {@link YellowPages} book and by the leaflet beside the solo
 * viewer's television. What each of those owns is the layout it flows the
 * blocks into; what is here is the printing.
 */

import { isHeadingKind } from '../../domain/directory';
import {
  formatPageNumber,
  titleOf,
  type Block,
  type Row,
} from './directoryRows';

/**
 * One listing row, whose whole width goes to its page.
 *
 * Also how a heading with nothing filed under it renders: it is a page like any
 * other, and giving it an arrow that opens an empty section would be a control
 * that does nothing. It keeps its count — every heading carries one — but the
 * click goes where the row says it goes.
 */
function Listing({
  row,
  onPick,
  count,
}: {
  row: Row;
  onPick: (pageNumber: number) => void;
  /** Lines in this heading's section, itself included. Omitted for a page. */
  count?: number;
}) {
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
        {/* Empty, but present: every row keeps the same gutter so a title's
            indent means depth rather than whether it happens to have an arrow. */}
        <span className="yellow-pages-caret" aria-hidden="true" />
        <span className="yellow-pages-name">{titleOf(node)}</span>
        {count != null && (
          <span className="yellow-pages-count" aria-hidden="true">
            {count}
          </span>
        )}
        <span className="yellow-pages-leader" aria-hidden="true" />
        <span className="yellow-pages-number">
          {formatPageNumber(node.pageNumber)}
        </span>
      </button>
    </li>
  );
}

/**
 * A heading row, which opens and closes the pages filed under it.
 *
 * Two controls on one line, not one. A heading is *both* a section and a page of
 * its own — 100 is the main index, and it is a real page someone may want to
 * dial — so the title opens the section and the number goes to the page. Folding
 * both into a single button would have meant choosing which of the two a click
 * meant, and losing the other.
 */
function Heading({
  row,
  count,
  open,
  onToggle,
  onPick,
  panelId,
}: {
  row: Row;
  /** Lines in the section, the heading's own page included. */
  count: number;
  open: boolean;
  onToggle: () => void;
  onPick: (pageNumber: number) => void;
  panelId: string;
}) {
  const { node, depth } = row;
  return (
    <li
      className={`yellow-pages-entry yellow-pages-entry-${node.kind} yellow-pages-entry-heading`}
      style={depth > 0 ? { paddingLeft: `${depth * 0.9}rem` } : undefined}
    >
      <button
        type="button"
        className="yellow-pages-entry-btn yellow-pages-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        // Named apart from the page number beside it, which carries the same
        // title: "TV Guide, 2 pages" opens the section, "TV Guide, page 200"
        // goes to it, and neither is mistakable for the other.
        aria-label={`${titleOf(node)}, ${count} page${count === 1 ? '' : 's'}`}
        onClick={onToggle}
      >
        <span className="yellow-pages-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="yellow-pages-name">{titleOf(node)}</span>
        {/* The count is the whole affordance for a collapsed section: without it
            a closed heading looks like an ordinary listing that happens to have
            a triangle. */}
        <span className="yellow-pages-count" aria-hidden="true">
          {count}
        </span>
        <span className="yellow-pages-leader" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="yellow-pages-number"
        aria-label={`${titleOf(node)}, page ${node.pageNumber}`}
        onClick={() => onPick(node.pageNumber)}
      >
        {formatPageNumber(node.pageNumber)}
      </button>
    </li>
  );
}

export interface DirectoryListProps {
  blocks: readonly Block[];
  /** Descendants per heading, from `descendantCounts`. */
  counts: ReadonlyMap<number, number>;
  openSections: ReadonlySet<number>;
  onToggleSection: (pageNumber: number) => void;
  /** Called with the page a row was pointed at. */
  onPick: (pageNumber: number) => void;
}

/**
 * The blocks, as a run of `<ul>`s the container is free to lay out however it
 * likes — columns in the book, one column in the leaflet.
 */
export function DirectoryList({
  blocks,
  counts,
  openSections,
  onToggleSection,
  onPick,
}: DirectoryListProps) {
  return (
    <>
      {blocks.map((block) => {
        // A block descended from a closed heading is not rendered at all — that
        // is what makes closing a *category* take its subcategories with it, and
        // not merely the loose pages that happened to land in its own block.
        if (!block.ancestors.every((page) => openSections.has(page))) return null;

        const [first, ...rest] = block.rows;
        const heading = isHeadingKind(first.node.kind) ? first : null;
        // A heading is a page in its own right, so its section counts itself:
        // "World News, 5" is this page plus the four beneath it.
        const below = heading == null ? 0 : (counts.get(heading.node.pageNumber) ?? 0);
        const count = below + 1;
        // Nothing under it means nothing to open, so it is an ordinary listing
        // rather than a control that does nothing.
        const collapsible = heading != null && below > 0;
        const open = !collapsible || openSections.has(heading.node.pageNumber);
        const panelId = `yp-section-${block.key}`;

        return (
          <ul key={block.key} className="yellow-pages-list">
            {heading != null &&
              (collapsible ? (
                <Heading
                  row={heading}
                  count={count}
                  open={open}
                  onToggle={() => onToggleSection(heading.node.pageNumber)}
                  onPick={onPick}
                  panelId={panelId}
                />
              ) : (
                <Listing row={heading} count={count} onPick={onPick} />
              ))}
            {/* Unmounted rather than hidden when closed: the book's flow is a
                multi-column layout measured to decide how many sheets it spills
                across, and rows that are merely invisible still take their
                columns. */}
            {open && rest.length > 0 && (
              <li className="yellow-pages-section" id={panelId}>
                <ul className="yellow-pages-list">
                  {rest.map((row) => (
                    <Listing key={row.node.pageNumber} row={row} onPick={onPick} />
                  ))}
                </ul>
              </li>
            )}
            {heading == null &&
              block.rows.map((row) => (
                <Listing key={row.node.pageNumber} row={row} onPick={onPick} />
              ))}
          </ul>
        );
      })}
    </>
  );
}

export default DirectoryList;
