import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell, TeletextPage } from '../../types/teletext';
import {
  COLS,
  isDoubleHeightShadow,
  isEffectiveDoubleHeight,
  MAX_DOUBLE_HEIGHT_ROW,
  MIN_DOUBLE_HEIGHT_ROW,
  ROWS,
  sixelBit,
  sixelPartAt,
} from '../../types/teletext';
import { formatSubpageIndicator } from '../../domain/subpages';
import { INDEX_LINE_RANGES, type IndexLineItem } from '../../domain/indexLine';
import { startBlinkClock } from '../../utils/blinkClock';

const VALID_PAGE_NUMBERS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);

/** Find all runs of 3 digits (100–999) in the page; return Map of cell index -> target page (100,200,...,900). */
function getPageLinkMap(page: TeletextPage): Map<number, number> {
  const map = new Map<number, number>();
  for (let row = 0; row < ROWS; row++) {
    let col = 0;
    while (col <= COLS - 3) {
      const c0 = page[row * COLS + col].char;
      const c1 = page[row * COLS + col + 1].char;
      const c2 = page[row * COLS + col + 2].char;
      if (/\d/.test(c0) && /\d/.test(c1) && /\d/.test(c2)) {
        const n = parseInt(c0 + c1 + c2, 10);
        if (n >= 100 && n <= 999) {
          const target = Math.round(n / 100) * 100;
          if (VALID_PAGE_NUMBERS.has(target)) {
            map.set(row * COLS + col, target);
            map.set(row * COLS + col + 1, target);
            map.set(row * COLS + col + 2, target);
            col += 3;
            continue;
          }
        }
      }
      col += 1;
    }
  }
  return map;
}

/**
 * The link map an editing grid uses: there are no page links while editing, and
 * a fresh `new Map()` each render would be a changed prop on every row.
 */
const NO_PAGE_LINKS: ReadonlyMap<number, number> = new Map();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatHeaderDateTime(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${day} ${month} ${year} ${h}:${m}:${s}`.padEnd(20).slice(0, 20);
}

function formatPageNumber(n: number): string {
  return String(n).padStart(3).slice(-3);
}

/**
 * Where the `X/Y` subpage counter sits in the header row.
 *
 * Column 4, one blank cell after the three-digit page number and well clear of
 * the date and time at column 20 — a broadcast header put the subpage counter
 * in exactly that gap, because it is the one part of the header that belongs to
 * the page number rather than to the clock. At its widest (`26/26`) it reaches
 * column 8.
 */
const SUBPAGE_COL = 4;

/**
 * Keep the shared blink phase running for as long as a grid is on screen.
 *
 * Reference-counted inside the clock, so however many grids are mounted there
 * is one timer between them and they blink together — see `utils/blinkClock.ts`.
 */
function useBlinkClock() {
  useEffect(() => startBlinkClock(), []);
}

function useLiveTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface TeletextGridProps {
  page: TeletextPage;
  pageNumber?: number;
  /**
   * Which screen of the page's carousel is showing, and how many there are.
   * Rendered in the header as `X/Y` beside the page number — always, including
   * `1/1`, the way a set showed it (see `domain/subpages.ts`).
   */
  subpage?: number;
  subpageCount?: number;
  cursorIndex?: number | null;
  onCellClick?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseDown?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseEnter?: (index: number, e?: React.MouseEvent) => void;
  /**
   * Fires as the pointer moves *within* a cell. Used by the pixel brush, which
   * needs finer granularity than cell-enter to paint individual sixths.
   */
  onCellMouseMove?: (index: number, e?: React.MouseEvent) => void;
  /**
   * Sixel sub-cell (0-5) to highlight on the cell at `cursorIndex`, so a
   * sub-cell brush can show what it is about to paint.
   */
  hoverPartIndex?: number | null;
  /**
   * When true, the cursor cell renders double-height (and the cell below it
   * is hidden the same way an actual double-height cell's would be) even
   * though the cell itself isn't double-height yet — a preview so the "Double
   * height" toggle shows what typing there will look like before it happens.
   */
  cursorDoubleHeight?: boolean;
  readOnly?: boolean;
  compact?: boolean;
  /**
   * Whether to draw the four-colour fastext strip below the page. Defaults to
   * `readOnly` — a set showed it whenever you were watching. The front page's
   * wall of thumbnails turns it off: the strip is identical on every page, so
   * nine of them side by side is a repeated smear rather than information.
   */
  showIndexLine?: boolean;
  /** When set (and readOnly), bottom line index links are clickable and call this with page number */
  onIndexPageSelect?: (page: number) => void;
  /** When set (and readOnly), clicking the top-left page number calls this so parent can open input */
  onPageNumberClick?: () => void;
  /**
   * Editing pointer, resolved from the grid's geometry rather than per cell.
   *
   * A touch drag does not visit the elements it passes over: the browser gives
   * every event to whatever the finger first landed on, so `mouseenter` — which
   * is how the brush used to follow a drag — never fires for the cells in
   * between. Painting was therefore impossible on a phone whatever the layout.
   *
   * The grid is a uniform 40x24, so the cell and the sixth within it are simple
   * arithmetic on the container's rectangle. That works for a mouse and a
   * finger alike, and costs no per-cell handlers at all — 2,880 closures a
   * render that the editor no longer builds.
   *
   * When this is set the grid takes over pointer handling; the per-cell mouse
   * props are left for the viewer, which uses them for page links.
   */
  onPointerCell?: (
    index: number,
    part: number,
    event: React.PointerEvent,
    phase: 'down' | 'move',
  ) => void;
  /** The pointer left the grid or was lifted: end any stroke in progress. */
  onPointerEnd?: () => void;
}

function SixelBlock({
  cell,
  hoverPartIndex = null,
}: {
  cell: Cell;
  /** Sub-cell to outline as the brush target, or null for none. */
  hoverPartIndex?: number | null;
}) {
  const pattern = (cell.graphics ?? 0) & 0x3f;
  const colors = cell.graphicsColors;
  return (
    <div className="teletext-sixel" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const filled = sixelBit(pattern, i);
        const color = filled
          ? (colors?.[i] ?? cell.fg)
          : cell.bg;
        return (
          <div
            key={i}
            className={`teletext-sixel-dot teletext-bg-${color}${
              hoverPartIndex === i ? ' teletext-sixel-dot-hover' : ''
            }`}
          />
        );
      })}
    </div>
  );
}

interface CellViewProps {
  cell: Cell;
  index: number;
  col: number;
  row: number;
  doubleHeight: boolean;
  isCursor: boolean;
  /** Sixth to outline as the brush target on *this* cell, or null. */
  hoverPart: number | null;
  /** Character the header overlays here — page number, counter or clock. */
  headerChar: string | null;
  headerFg: Cell['fg'] | null;
  pageLinkTarget?: number;
  readOnly: boolean;
  pageNumberClickable: boolean;
  onCellClick?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseDown?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseEnter?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseMove?: (index: number, e?: React.MouseEvent) => void;
  onIndexPageSelect?: (page: number) => void;
  onPageNumberClick?: () => void;
}

/**
 * One cell of the grid, and the reason it is a component at all.
 *
 * A page is 960 of these. Rendering them inline meant every one was rebuilt
 * whenever anything changed — a keystroke, a clock tick, a stroke of the brush,
 * someone else editing a different page — so a drag cost 960 elements per
 * pointer event and drawing lagged behind the pointer.
 *
 * Memoised, a cell re-renders when *its own* data changes. That only works
 * because the page keeps the identity of cells that did not change
 * (`domain/pageReuse.ts`) and because the handlers below are stable in the
 * editor; without either, every prop would be new every time and this would be
 * a comparison that always fails, which is slower than not comparing at all.
 */
const CellView = memo(function CellView({
  cell,
  index,
  col,
  row,
  doubleHeight,
  isCursor,
  hoverPart,
  headerChar,
  headerFg,
  pageLinkTarget,
  readOnly,
  pageNumberClickable,
  onCellClick,
  onCellMouseDown,
  onCellMouseEnter,
  onCellMouseMove,
  onIndexPageSelect,
  onPageNumberClick,
}: CellViewProps) {
  const isHeaderOverlay = headerChar !== null;
  const isPageCell = row === 0 && col < 3;

  const displayCell =
    headerChar !== null
      ? { ...cell, char: headerChar, fg: headerFg as typeof cell.fg }
      : cell;
  const hasGraphics =
    !isHeaderOverlay &&
    typeof displayCell.graphics === 'number' &&
    displayCell.graphics >= 0 &&
    displayCell.graphics <= 63;
  // The sub-cell brush target. A blank cell without graphics still shows the
  // highlight (rendered as an all-background sixel block, which looks identical
  // to the blank cell); a cell with a character keeps the character and settles
  // for the cell-level cursor outline.
  const isHoverTarget = !readOnly && !isHeaderOverlay && hoverPart != null;
  const showGraphics =
    hasGraphics ||
    (isHoverTarget && (displayCell.char === ' ' || displayCell.char === ''));
  const displayChar: string = isHeaderOverlay
    ? headerChar === ' ' || headerChar === null
      ? '\u00a0'
      : headerChar
    : displayCell.char === ' '
      ? '\u00a0'
      : displayCell.char;
  const isPageLink = pageLinkTarget != null;

  const handleClick =
    pageNumberClickable && isPageCell
      ? (e: React.MouseEvent) => {
          e.preventDefault();
          onPageNumberClick?.();
        }
      : pageLinkTarget != null
        ? (e: React.MouseEvent) => {
            e.preventDefault();
            onIndexPageSelect?.(pageLinkTarget);
          }
        : (e: React.MouseEvent) => onCellClick?.(index, e);

  const inert = (isPageCell && pageNumberClickable) || isPageLink;
  const content = showGraphics ? (
    <SixelBlock
      cell={hasGraphics ? displayCell : { ...displayCell, graphics: 0 }}
      hoverPartIndex={isHoverTarget ? hoverPart : null}
    />
  ) : (
    displayChar
  );

  return (
    <div
      className={`teletext-cell teletext-fg-${displayCell.fg} teletext-bg-${displayCell.bg} ${
        !readOnly && isCursor ? 'cursor' : ''
      } ${!isHeaderOverlay && displayCell.blink ? 'teletext-blink' : ''} ${pageNumberClickable && isPageCell ? 'teletext-page-number-clickable' : ''} ${isPageLink ? 'teletext-index-link' : ''} ${doubleHeight ? 'teletext-cell-double-height' : ''}`}
      style={{
        gridColumn: col + 1,
        gridRow: doubleHeight ? `${row + 1} / span 2` : row + 1,
      }}
      onClick={handleClick}
      onMouseDown={inert ? undefined : (e: React.MouseEvent) => onCellMouseDown?.(index, e)}
      onMouseEnter={inert ? undefined : (e: React.MouseEvent) => onCellMouseEnter?.(index, e)}
      onMouseMove={
        onCellMouseMove == null || inert
          ? undefined
          : (e: React.MouseEvent) => onCellMouseMove(index, e)
      }
      role={readOnly ? (inert ? 'button' : undefined) : 'button'}
      tabIndex={-1}
    >
      {doubleHeight ? (
        <span className="teletext-cell-dh-content">{content}</span>
      ) : (
        content
      )}
    </div>
  );
});

/**
 * The three header fields, which are the only part of the grid that ticks.
 *
 * Passed to row 0 and to nothing else, so the clock — which changes once a
 * second, forever — cannot invalidate the twenty-three rows that do not show it.
 */
interface HeaderOverlay {
  pageStr: string;
  subpageStr: string;
  dateTimeStr: string;
}

interface GridRowProps {
  page: TeletextPage;
  row: number;
  /** Header fields on row 0; null on every other row. */
  header: HeaderOverlay | null;
  /** Column of the local cursor within this row, or null when it is elsewhere. */
  cursorCol: number | null;
  /** Sixth to outline on the cursor cell, when the cursor is in this row. */
  hoverPart: number | null;
  /** Column showing the double-height typing preview, or null. */
  previewCol: number | null;
  /** Column covered by a double-height preview on the row above, or null. */
  previewShadowCol: number | null;
  pageLinkMap: ReadonlyMap<number, number>;
  readOnly: boolean;
  pageNumberClickable: boolean;
  onCellClick?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseDown?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseEnter?: (index: number, e?: React.MouseEvent) => void;
  onCellMouseMove?: (index: number, e?: React.MouseEvent) => void;
  onIndexPageSelect?: (page: number) => void;
  onPageNumberClick?: () => void;
}

/**
 * Whether a row would render identically, so React can skip it whole.
 *
 * `CellView` being memoised stops a cell *re-rendering*, but not the grid
 * building all 960 of its elements and React walking all 960 fibres to discover
 * that 959 of them bailed out. At a stroke's pointer rate that walk is the cost;
 * a keystroke or a painted cell only ever touches one or two rows.
 *
 * The page is compared by cell *identity*, which is meaningful because
 * `domain/pageReuse.ts` keeps the identity of cells that did not change. Two
 * rows are compared, not one: a double-height cell's box spans down into the
 * row below, so a row's appearance depends on the row above it as well as its
 * own (see `isDoubleHeightShadow`).
 *
 * Every prop is listed. A prop added above and forgotten here is a row that
 * silently stops updating, which is why there are no spreads in `GridRowProps`.
 */
function sameRow(prev: GridRowProps, next: GridRowProps): boolean {
  if (
    prev.row !== next.row ||
    prev.cursorCol !== next.cursorCol ||
    prev.hoverPart !== next.hoverPart ||
    prev.previewCol !== next.previewCol ||
    prev.previewShadowCol !== next.previewShadowCol ||
    prev.pageLinkMap !== next.pageLinkMap ||
    prev.readOnly !== next.readOnly ||
    prev.pageNumberClickable !== next.pageNumberClickable ||
    prev.onCellClick !== next.onCellClick ||
    prev.onCellMouseDown !== next.onCellMouseDown ||
    prev.onCellMouseEnter !== next.onCellMouseEnter ||
    prev.onCellMouseMove !== next.onCellMouseMove ||
    prev.onIndexPageSelect !== next.onIndexPageSelect ||
    prev.onPageNumberClick !== next.onPageNumberClick
  ) {
    return false;
  }

  // Compared by value: the header object is rebuilt every tick, but its
  // contents only change when the clock's second — or the page number — does.
  const a = prev.header;
  const b = next.header;
  if (a !== b) {
    if (a == null || b == null) return false;
    if (
      a.pageStr !== b.pageStr ||
      a.subpageStr !== b.subpageStr ||
      a.dateTimeStr !== b.dateTimeStr
    ) {
      return false;
    }
  }

  if (prev.page !== next.page) {
    const from = next.row > 0 ? (next.row - 1) * COLS : 0;
    const to = (next.row + 1) * COLS;
    for (let i = from; i < to; i += 1) {
      if (prev.page[i] !== next.page[i]) return false;
    }
  }

  return true;
}

/**
 * One row of forty cells.
 *
 * `display: contents` — the wrapper places nothing itself, so the cells stay
 * direct grid items of `.teletext-grid` and keep the explicit `gridColumn` /
 * `gridRow` they already carried. The row exists only to give React a memo
 * boundary at a useful size.
 */
const GridRow = memo(function GridRow({
  page,
  row,
  header,
  cursorCol,
  hoverPart,
  previewCol,
  previewShadowCol,
  pageLinkMap,
  readOnly,
  pageNumberClickable,
  onCellClick,
  onCellMouseDown,
  onCellMouseEnter,
  onCellMouseMove,
  onIndexPageSelect,
  onPageNumberClick,
}: GridRowProps) {
  const start = row * COLS;
  const cells: React.ReactNode[] = [];

  for (let col = 0; col < COLS; col += 1) {
    const index = start + col;

    // A cell covered by a double-height cell directly above it renders nothing
    // — that cell's own box already spans down into this row. The cursor
    // preview covers its cell below the same way, before anything is typed.
    if (col === previewShadowCol || isDoubleHeightShadow(page, index)) continue;

    const doubleHeight = col === previewCol || isEffectiveDoubleHeight(page, index);

    const isPageCell = header != null && col < 3;
    const isSubpageCell =
      header != null && col >= SUBPAGE_COL && col < SUBPAGE_COL + header.subpageStr.length;
    const isDateTimeCell = header != null && col >= 20;
    const headerChar = isPageCell
      ? header.pageStr[col]
      : isSubpageCell
        ? header.subpageStr[col - SUBPAGE_COL]
        : isDateTimeCell
          ? header.dateTimeStr[col - 20]
          : null;
    // Cyan, so the counter reads as a separate fact from the page number it
    // sits beside rather than as more digits of it.
    const headerFg = isPageCell
      ? 'white'
      : isSubpageCell
        ? 'cyan'
        : isDateTimeCell
          ? 'yellow'
          : null;

    cells.push(
      <CellView
        key={index}
        cell={page[index]}
        index={index}
        col={col}
        row={row}
        doubleHeight={doubleHeight}
        isCursor={col === cursorCol}
        // Only the cell under the pointer is told about the sixth, so the other
        // thirty-nine in the row are not re-rendered every time it moves.
        hoverPart={col === cursorCol ? hoverPart : null}
        headerChar={headerChar}
        headerFg={headerFg as Cell['fg'] | null}
        pageLinkTarget={headerChar === null ? pageLinkMap.get(index) : undefined}
        readOnly={readOnly}
        pageNumberClickable={pageNumberClickable}
        onCellClick={onCellClick}
        onCellMouseDown={onCellMouseDown}
        onCellMouseEnter={onCellMouseEnter}
        onCellMouseMove={onCellMouseMove}
        onIndexPageSelect={onIndexPageSelect}
        onPageNumberClick={onPageNumberClick}
      />,
    );
  }

  return <div className="teletext-row">{cells}</div>;
}, sameRow);

const ROW_INDICES = Array.from({ length: ROWS }, (_, row) => row);

export function TeletextGrid({
  page,
  pageNumber = 100,
  subpage = 1,
  subpageCount = 1,
  cursorIndex = null,
  onCellClick,
  onCellMouseDown,
  onCellMouseEnter,
  onCellMouseMove,
  hoverPartIndex = null,
  cursorDoubleHeight = false,
  readOnly = false,
  compact = false,
  showIndexLine: showIndexLineProp,
  onIndexPageSelect,
  onPageNumberClick,
  onPointerCell,
  onPointerEnd,
}: TeletextGridProps) {
  const now = useLiveTime();
  useBlinkClock();
  const gridRef = useRef<HTMLDivElement>(null);
  const pageStr = formatPageNumber(pageNumber);
  const subpageStr = formatSubpageIndicator(subpage, subpageCount);
  const dateTimeStr = formatHeaderDateTime(now);
  const showIndexLine = showIndexLineProp ?? readOnly;
  const indexClickable = showIndexLine && onIndexPageSelect != null;
  const pageNumberClickable = readOnly && onPageNumberClick != null;
  const pageLinkMap = useMemo(
    () => (readOnly && onIndexPageSelect ? getPageLinkMap(page) : NO_PAGE_LINKS),
    [page, readOnly, onIndexPageSelect],
  );

  /**
   * The grid's box, measured when it could have moved rather than per sample.
   *
   * `getBoundingClientRect` forces the browser to lay the grid out *there and
   * then* — nearly a thousand cells, immediately after React has mutated some
   * of them for the previous sample. Doing that inside every `pointermove` of a
   * stroke means a full synchronous layout per sample, which on a phone is most
   * of the frame, and it is what made the brush trail behind the finger.
   *
   * The box only changes when the grid is resized, scrolled or reflowed, so it
   * is cached until one of those happens (and re-read at the start of each
   * stroke, which costs one layout per stroke instead of one per sample).
   */
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const element = gridRef.current;
    if (element == null) return;
    const invalidate = () => {
      rectRef.current = null;
    };
    // Absent in jsdom, and its absence must not take the grid with it.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
    observer?.observe(element);
    // Capturing, so a scroll of any ancestor counts and not just the window's.
    window.addEventListener('scroll', invalidate, true);
    window.addEventListener('resize', invalidate);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', invalidate, true);
      window.removeEventListener('resize', invalidate);
    };
  }, []);

  /**
   * Which cell, and which sixth of it, a pointer is over.
   *
   * Measured off the grid's own box: 40 columns and 24 rows of equal size, so
   * the arithmetic is exact and needs no lookup. Returns null outside the
   * drawable area — including the header row, which is not a cell anyone edits.
   */
  const resolvePointer = useCallback(
    (event: React.PointerEvent): { index: number; part: number } | null => {
      const element = gridRef.current;
      if (element == null) return null;
      let rect = rectRef.current;
      if (rect == null) {
        rect = element.getBoundingClientRect();
        rectRef.current = rect;
      }
      if (rect.width <= 0 || rect.height <= 0) return null;

      const cellWidth = rect.width / COLS;
      // The index line is an extra row in the same grid, so it has to be
      // counted or every row below the first would be measured slightly short.
      const cellHeight = rect.height / (showIndexLine ? ROWS + 1 : ROWS);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const col = Math.floor(x / cellWidth);
      const row = Math.floor(y / cellHeight);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;

      return {
        index: row * COLS + col,
        part: sixelPartAt(x - col * cellWidth, y - row * cellHeight, cellWidth, cellHeight),
      };
    },
    [showIndexLine],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (onPointerCell == null) return;
      // One fresh measurement per stroke: cheap here, and it means a layout
      // change nothing thought to announce cannot leave a stroke painting in
      // the wrong place.
      rectRef.current = null;
      const hit = resolvePointer(event);
      if (hit == null) return;
      // Capture, so a stroke that wanders off the grid — or off the window —
      // still reports its end, and a finger keeps painting after it leaves the
      // element it started on.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onPointerCell(hit.index, hit.part, event, 'down');
    },
    [onPointerCell, resolvePointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (onPointerCell == null) return;
      const hit = resolvePointer(event);
      if (hit == null) return;
      onPointerCell(hit.index, hit.part, event, 'move');
    },
    [onPointerCell, resolvePointer],
  );

  // The double-height preview only makes sense on an actual cursor cell
  // within the valid double-height row range (matches `isEffectiveDoubleHeight`'s
  // own row check) — never in read-only view, which has no local cursor.
  const cursorPreviewRow = cursorIndex != null ? Math.floor(cursorIndex / COLS) : -1;
  const cursorPreviewEligible =
    !readOnly &&
    cursorDoubleHeight &&
    cursorIndex != null &&
    cursorPreviewRow >= MIN_DOUBLE_HEIGHT_ROW &&
    cursorPreviewRow <= MAX_DOUBLE_HEIGHT_ROW;

  const cursorRow = cursorIndex != null ? Math.floor(cursorIndex / COLS) : -1;
  const cursorCol = cursorIndex != null ? cursorIndex % COLS : -1;
  const header: HeaderOverlay = { pageStr, subpageStr, dateTimeStr };

  return (
    <div className={`teletext-screen${compact ? ' teletext-screen-compact' : ''}${showIndexLine ? ' teletext-screen-with-index' : ''}`}>
      <div
        ref={gridRef}
        className={`teletext-grid${showIndexLine ? ' teletext-grid-with-index' : ''}${
          onPointerCell != null ? ' teletext-grid-drawable' : ''
        }`}
        onPointerDown={onPointerCell == null ? undefined : handlePointerDown}
        onPointerMove={onPointerCell == null ? undefined : handlePointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {/*
          * All 24 rows of page content, a memoised component each — no overlay
          * on row 23 when we have a separate index row.
          *
          * Row by row rather than cell by cell so that a keystroke, or a cell
          * of a stroke, reconciles the forty cells it could have changed rather
          * than all nine hundred and sixty (see `sameRow`).
          */}
        {ROW_INDICES.map((row) => (
          <GridRow
            key={row}
            page={page}
            row={row}
            header={row === 0 ? header : null}
            cursorCol={row === cursorRow ? cursorCol : null}
            hoverPart={row === cursorRow ? hoverPartIndex : null}
            previewCol={cursorPreviewEligible && row === cursorPreviewRow ? cursorCol : null}
            previewShadowCol={
              cursorPreviewEligible && row === cursorPreviewRow + 1 ? cursorCol : null
            }
            pageLinkMap={pageLinkMap}
            readOnly={readOnly}
            pageNumberClickable={pageNumberClickable}
            onCellClick={onPointerCell == null ? onCellClick : undefined}
            onCellMouseDown={onPointerCell == null ? onCellMouseDown : undefined}
            onCellMouseEnter={onPointerCell == null ? onCellMouseEnter : undefined}
            onCellMouseMove={onPointerCell == null ? onCellMouseMove : undefined}
            onIndexPageSelect={onIndexPageSelect}
            onPageNumberClick={onPageNumberClick}
          />
        ))}
        {/* Extra row 25: index line (INDEX / TV GUIDE / WORLD / FINANCE) when in view mode */}
        {showIndexLine &&
          Array.from({ length: COLS }, (_, col) => {
            let displayChar = '\u00a0';
            let indexLink: IndexLineItem | null = null;
            for (const { start, end, item } of INDEX_LINE_RANGES) {
              if (col >= start && col < end) {
                displayChar = item.label[col - start];
                indexLink = item;
                break;
              }
            }
            const cellFg = indexLink ? indexLink.fg : 'black';
            return (
              <div
                key={`index-${col}`}
                className={`teletext-cell teletext-fg-${cellFg} teletext-bg-black ${indexClickable && indexLink ? 'teletext-index-link' : ''}`}
                style={{ gridColumn: col + 1, gridRow: ROWS + 1 }}
                onClick={indexClickable && indexLink ? (e: React.MouseEvent) => { e.preventDefault(); onIndexPageSelect?.(indexLink!.page); } : undefined}
                role={indexClickable && indexLink ? 'button' : undefined}
                tabIndex={-1}
              >
                {displayChar}
              </div>
            );
          })}
      </div>
    </div>
  );
}
