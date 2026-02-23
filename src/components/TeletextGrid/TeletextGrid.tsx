import { useEffect, useState } from 'react';
import type { Cell, TeletextPage } from '../../types/teletext';
import { COLS, ROWS, sixelBit } from '../../types/teletext';

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
  cursorIndex?: number | null;
  onCellClick?: (index: number) => void;
  onCellMouseDown?: (index: number) => void;
  onCellMouseEnter?: (index: number) => void;
  readOnly?: boolean;
  compact?: boolean;
  /** When set (and readOnly), bottom line index links are clickable and call this with page number */
  onIndexPageSelect?: (page: number) => void;
  /** When set (and readOnly), clicking the top-left page number calls this so parent can open input */
  onPageNumberClick?: () => void;
}

function SixelBlock({ cell }: { cell: Cell }) {
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
            className={`teletext-sixel-dot teletext-bg-${color}`}
          />
        );
      })}
    </div>
  );
}

export function TeletextGrid({
  page,
  pageNumber = 100,
  cursorIndex = null,
  onCellClick,
  onCellMouseDown,
  onCellMouseEnter,
  readOnly = false,
  compact = false,
  onIndexPageSelect,
  onPageNumberClick,
}: TeletextGridProps) {
  const now = useLiveTime();
  const pageStr = formatPageNumber(pageNumber);
  const dateTimeStr = formatHeaderDateTime(now);
  const showIndexLine = readOnly;
  const indexClickable = showIndexLine && onIndexPageSelect != null;
  const pageNumberClickable = readOnly && onPageNumberClick != null;

  return (
    <div className={`teletext-screen${compact ? ' teletext-screen-compact' : ''}${showIndexLine ? ' teletext-screen-with-index' : ''}`}>
      <div className={`teletext-grid${showIndexLine ? ' teletext-grid-with-index' : ''}`}>
        {/* All 24 rows of page content — no overlay on row 23 when we have a separate index row */}
        {page.map((cell, index) => {
          const row = Math.floor(index / COLS);
          const col = index % COLS;
          const isHeaderRow = row === 0;
          const isPageCell = isHeaderRow && col < 3;
          const isDateTimeCell = isHeaderRow && col >= 20;
          const isHeaderOverlay = isPageCell || isDateTimeCell;
          const headerChar = isPageCell
            ? pageStr[col]
            : isDateTimeCell
              ? dateTimeStr[col - 20]
              : null;
          const headerFg = isPageCell ? 'white' : isDateTimeCell ? 'yellow' : null;

          const displayCell = headerChar !== null ? { ...cell, char: headerChar, fg: headerFg as typeof cell.fg } : cell;
          const showGraphics = !isHeaderOverlay && typeof displayCell.graphics === 'number' && displayCell.graphics >= 0 && displayCell.graphics <= 63;
          const displayChar: string = isHeaderOverlay ? (headerChar === ' ' || headerChar === null ? '\u00a0' : headerChar) : (displayCell.char === ' ' ? '\u00a0' : displayCell.char);
          const cellFg = displayCell.fg;
          const handleClick = pageNumberClickable && isPageCell
            ? (e: React.MouseEvent) => { e.preventDefault(); onPageNumberClick?.(); }
            : () => onCellClick?.(index);
          return (
            <div
              key={index}
              className={`teletext-cell teletext-fg-${cellFg} teletext-bg-${displayCell.bg} ${
                !readOnly && cursorIndex === index ? 'cursor' : ''
              } ${pageNumberClickable && isPageCell ? 'teletext-page-number-clickable' : ''}`}
              onClick={handleClick}
              onMouseDown={isPageCell && pageNumberClickable ? undefined : () => onCellMouseDown?.(index)}
              onMouseEnter={isPageCell && pageNumberClickable ? undefined : () => onCellMouseEnter?.(index)}
              role={readOnly ? (pageNumberClickable && isPageCell ? 'button' : undefined) : 'button'}
              tabIndex={-1}
            >
              {showGraphics ? (
                <SixelBlock cell={displayCell} />
              ) : (
                displayChar
              )}
            </div>
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
