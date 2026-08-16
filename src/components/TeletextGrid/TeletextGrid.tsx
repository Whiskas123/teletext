import { memo, useEffect, useMemo, useState } from 'react';
import type { Cell, TeletextPage } from '../../types/teletext';
import {
  COLS,
  isDoubleHeightShadow,
  isEffectiveDoubleHeight,
  MAX_DOUBLE_HEIGHT_ROW,
  MIN_DOUBLE_HEIGHT_ROW,
  ROWS,
  sixelBit,
} from '../../types/teletext';
import { formatSubpageIndicator } from '../../domain/subpages';

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

function useLiveTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const COLS_PER_INDEX = 10; /* 40 / 4 */
const INDEX_LINE: { label: string; fg: 'red' | 'green' | 'yellow' | 'cyan'; page: number }[] = [
  { label: 'INDEX', fg: 'red', page: 100 },
  { label: 'TV GUIDE', fg: 'green', page: 200 },
  { label: 'WORLD', fg: 'yellow', page: 300 },
  { label: 'FINANCE', fg: 'cyan', page: 400 },
];

/** Start column for each word so they're evenly spaced (centered in 10‑column zones) */
const INDEX_LINE_RANGES: { start: number; end: number; item: (typeof INDEX_LINE)[number] }[] = INDEX_LINE.map(
  (item, i) => {
    const zoneStart = i * COLS_PER_INDEX;
    const start = zoneStart + Math.floor((COLS_PER_INDEX - item.label.length) / 2);
    return { start, end: start + item.label.length, item };
  }
);

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
}: TeletextGridProps) {
  const now = useLiveTime();
  const pageStr = formatPageNumber(pageNumber);
  const subpageStr = formatSubpageIndicator(subpage, subpageCount);
  const dateTimeStr = formatHeaderDateTime(now);
  const showIndexLine = showIndexLineProp ?? readOnly;
  const indexClickable = showIndexLine && onIndexPageSelect != null;
  const pageNumberClickable = readOnly && onPageNumberClick != null;
  const pageLinkMap = useMemo(() => (readOnly && onIndexPageSelect ? getPageLinkMap(page) : new Map<number, number>()), [page, readOnly, onIndexPageSelect]);

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

  return (
    <div className={`teletext-screen${compact ? ' teletext-screen-compact' : ''}${showIndexLine ? ' teletext-screen-with-index' : ''}`}>
      <div className={`teletext-grid${showIndexLine ? ' teletext-grid-with-index' : ''}`}>
        {/* All 24 rows of page content — no overlay on row 23 when we have a separate index row */}
        {page.map((cell, index) => {
          const row = Math.floor(index / COLS);
          const col = index % COLS;

          // A cell covered by a double-height cell directly above it renders
          // nothing — that cell's own box already spans down into this row (see
          // the `gridRow` span in `CellView`). Every other cell gets explicit
          // grid placement so these gaps don't get backfilled by auto-placement.
          // The cursor preview (see `cursorDoubleHeight`) covers its cell below
          // the same way, even though nothing has actually been typed yet.
          const isCursorPreviewShadow =
            cursorPreviewEligible && index === (cursorIndex as number) + COLS;
          if (isDoubleHeightShadow(page, index) || isCursorPreviewShadow) return null;
          const isCursorPreviewDoubleHeight =
            cursorPreviewEligible && index === cursorIndex;
          const doubleHeight =
            isEffectiveDoubleHeight(page, index) || isCursorPreviewDoubleHeight;

          const isHeaderRow = row === 0;
          const isPageCell = isHeaderRow && col < 3;
          const isSubpageCell =
            isHeaderRow && col >= SUBPAGE_COL && col < SUBPAGE_COL + subpageStr.length;
          const isDateTimeCell = isHeaderRow && col >= 20;
          const headerChar = isPageCell
            ? pageStr[col]
            : isSubpageCell
              ? subpageStr[col - SUBPAGE_COL]
              : isDateTimeCell
                ? dateTimeStr[col - 20]
                : null;
          // Cyan, so the counter reads as a separate fact from the page number
          // it sits beside rather than as more digits of it.
          const headerFg = isPageCell
            ? 'white'
            : isSubpageCell
              ? 'cyan'
              : isDateTimeCell
                ? 'yellow'
                : null;

          return (
            <CellView
              key={index}
              cell={cell}
              index={index}
              col={col}
              row={row}
              doubleHeight={doubleHeight}
              isCursor={cursorIndex === index}
              // Only the cell under the pointer is told about the sixth, so the
              // other 959 are not re-rendered every time it moves.
              hoverPart={cursorIndex === index ? hoverPartIndex : null}
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
            />
          );
        })}
        {/* Extra row 25: index line (INDEX / TV GUIDE / WORLD / FINANCE) when in view mode */}
        {showIndexLine &&
          Array.from({ length: COLS }, (_, col) => {
            let displayChar = '\u00a0';
            let indexLink: (typeof INDEX_LINE)[number] | null = null;
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
