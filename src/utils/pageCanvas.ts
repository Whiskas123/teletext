/**
 * Drawing a teletext page onto a canvas.
 *
 * The same page has two renderers, and they are for different jobs. The DOM one
 * (`components/TeletextGrid`) is what you can put a cursor in, click a cell of,
 * and watch blink — it costs a `<div>` per cell, ~1,500 nodes a page, which is
 * the price of being interactive.
 *
 * This one is for when a page is a *picture*: the PNG export, and the front
 * page's wall of nine thumbnails. Nine interactive grids came to 12,000 DOM
 * nodes on the first screen a visitor meets, all of it laid out and painted for
 * something nobody can click into. Nine canvases are nine nodes.
 *
 * Extracted from `exportPng.ts` rather than written afresh so the two cannot
 * drift: whatever the export shows is what the thumbnail shows.
 */

import type { SixelColors, TeletextPage } from '../types/teletext';
import {
  isDoubleHeightShadow,
  isEffectiveDoubleHeight,
  sixelBit,
  TELETEXT_COLOR_HEX,
} from '../types/teletext';
import { formatSubpageIndicator } from '../domain/subpages';

// Widened to a plain string index so callers here (which look colors up by
// plain `string`, not the narrower `TeletextColor`) can index it directly.
const COLOR_HEX = TELETEXT_COLOR_HEX as Record<string, string | undefined>;

export const COLS = 40;
export const ROWS = 24;
/** Cell size at scale 1, and so the page's natural pixel size. */
export const CELL_W = 14;
export const CELL_H = 18;
export const PAGE_W = COLS * CELL_W;
export const PAGE_H = ROWS * CELL_H;

const FONT_PX = 14;
const FONT_STACK = '"Press Start 2P", "Courier New", Courier, monospace';

/** Where the `X/Y` subpage counter sits, matching the DOM renderer. */
const SUBPAGE_COL = 4;

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

const INDEX_LINE_RANGES: { start: number; end: number; label: string; fg: string }[] = [
  { label: 'INDEX', fg: 'red', start: 2, end: 7 },
  { label: 'TV GUIDE', fg: 'green', start: 10, end: 19 },
  { label: 'WORLD', fg: 'yellow', start: 22, end: 27 },
  { label: 'FINANCE', fg: 'cyan', start: 31, end: 38 },
];

function drawSixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pattern: number,
  colors: SixelColors | undefined,
  defaultFg: string,
  bg: string,
  cellHeight: number = CELL_H,
) {
  const w = CELL_W / 2;
  const h = cellHeight / 3;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, CELL_W, cellHeight);
  for (let i = 0; i < 6; i++) {
    const filled = sixelBit(pattern, i);
    if (!filled) continue;
    const color = colors?.[i] ?? defaultFg;
    ctx.fillStyle = COLOR_HEX[color] ?? defaultFg;
    const col = i % 2;
    const row = Math.floor(i / 2);
    ctx.fillRect(x + col * w, y + row * h, w, h);
  }
}

export interface DrawPageOptions {
  pageNumber?: number;
  /** Which screen of the carousel, and how many — the header's `X/Y`. */
  subpage?: number;
  subpageCount?: number;
  /** The four-colour fastext strip on the last row. */
  showIndexLine?: boolean;
  /** Header clock. Passed in so a caller can freeze it, and tests can fix it. */
  now?: Date;
}

/**
 * Draw `page` into `ctx` at its natural size ({@link PAGE_W} × {@link PAGE_H}).
 *
 * Scaling is the caller's: set a transform on the context, or size the canvas
 * and let CSS do it. Keeping this at one fixed size means the layout arithmetic
 * — cell positions, the doubled height, the sixel sub-grid — is written once.
 */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  page: TeletextPage,
  {
    pageNumber = 100,
    subpage = 1,
    subpageCount = 1,
    showIndexLine = true,
    now = new Date(),
  }: DrawPageOptions = {},
): void {
  ctx.font = `${FONT_PX}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';

  const pageStr = formatPageNumber(pageNumber);
  const subpageStr = formatSubpageIndicator(subpage, subpageCount);
  const dateTimeStr = formatHeaderDateTime(now);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      // This row is covered by a double-height cell directly above it — its
      // own content already got drawn (stretched) by that cell.
      if (isDoubleHeightShadow(page, index)) continue;
      const cell = page[index];
      const doubleHeight = isEffectiveDoubleHeight(page, index);
      const cellHeight = doubleHeight ? CELL_H * 2 : CELL_H;
      const bg = COLOR_HEX[cell.bg] ?? '#000000';
      let fg = COLOR_HEX[cell.fg] ?? '#ffffff';
      let char = cell.char === ' ' ? ' ' : cell.char;
      const x = col * CELL_W;
      const y = row * CELL_H;

      let isHeaderOverlay = false;
      if (row === 0) {
        if (col < 3) {
          char = pageStr[col];
          fg = '#ffffff';
          isHeaderOverlay = true;
        } else if (col >= SUBPAGE_COL && col < SUBPAGE_COL + subpageStr.length) {
          char = subpageStr[col - SUBPAGE_COL];
          fg = COLOR_HEX.cyan ?? '#00ffff';
          isHeaderOverlay = true;
        } else if (col >= 20) {
          char = dateTimeStr[col - 20];
          fg = '#ffff00';
          isHeaderOverlay = true;
        }
      } else if (row === ROWS - 1 && showIndexLine) {
        const hit = INDEX_LINE_RANGES.find((r) => col >= r.start && col < r.end);
        char = hit == null ? ' ' : hit.label[col - hit.start];
        if (hit != null) fg = COLOR_HEX[hit.fg] ?? fg;
        isHeaderOverlay = true;
      }

      const isGraphics =
        !isHeaderOverlay &&
        typeof cell.graphics === 'number' &&
        cell.graphics >= 0 &&
        cell.graphics <= 63;
      if (isGraphics) {
        drawSixel(ctx, x, y, cell.graphics! & 0x3f, cell.graphicsColors, fg, bg, cellHeight);
      } else {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL_W, cellHeight);
        ctx.fillStyle = fg;
        if (doubleHeight) {
          // Stretch the glyph vertically to fill the doubled cell height,
          // matching the live CSS rendering's `scaleY(2)`.
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(1, 2);
          ctx.fillText(char, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(char, x, y);
        }
      }
    }
  }
}
