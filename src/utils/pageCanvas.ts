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
  px: (v: number) => number,
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
  fillSnapped(ctx, px, x, y, CELL_W, cellHeight);
  for (let i = 0; i < 6; i++) {
    const filled = sixelBit(pattern, i);
    if (!filled) continue;
    const color = colors?.[i] ?? defaultFg;
    ctx.fillStyle = COLOR_HEX[color] ?? defaultFg;
    const col = i % 2;
    const row = Math.floor(i / 2);
    // A sixel is a cell in thirds: 18/3 is whole, but 13.5/3 is not, so the
    // sub-rects need snapping exactly as the cells do.
    fillSnapped(ctx, px, x + col * w, y + row * h, w, h);
  }
}

/**
 * Fill a rectangle on whole device pixels, so neighbours meet exactly.
 *
 * This is the fix for the thin black grid that appeared over a scaled page.
 * Cells are 14x18 in page coordinates, which at a scale of 0.75 is 10.5x13.5 —
 * fractional edges, which the canvas antialiases. Two antialiased edges meeting
 * do not add up to an opaque pixel, so a seam of the backdrop showed through
 * between every pair of cells.
 *
 * Snapping each edge with the *same* rounding means one cell's right edge and
 * the next cell's left edge land on the same integer: the seam has nowhere to
 * appear, and no cell is drawn twice.
 */
function fillSnapped(
  ctx: CanvasRenderingContext2D,
  px: (v: number) => number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const x0 = px(x);
  const y0 = px(y);
  ctx.fillRect(x0, y0, px(x + w) - x0, px(y + h) - y0);
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
  /**
   * Device pixels per page pixel.
   *
   * Applied here rather than by the caller's `ctx.scale`, because the geometry
   * has to be snapped to whole pixels *after* scaling — see {@link fillSnapped}.
   */
  scale?: number;
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
    scale = 1,
  }: DrawPageOptions = {},
): void {
  const px = (v: number) => Math.round(v * scale);
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
        drawSixel(ctx, px, x, y, cell.graphics! & 0x3f, cell.graphicsColors, fg, bg, cellHeight);
      } else {
        ctx.fillStyle = bg;
        fillSnapped(ctx, px, x, y, CELL_W, cellHeight);
        ctx.fillStyle = fg;
        // The glyph is scaled by the transform while the box around it was
        // snapped above; a character may be a fraction of a pixel off its cell,
        // which is invisible, whereas a gap between cells is not.
        ctx.save();
        ctx.translate(px(x), px(y));
        // Double height stretches the glyph to fill the doubled box, matching
        // the live CSS rendering's `scaleY(2)`.
        ctx.scale(scale, doubleHeight ? scale * 2 : scale);
        ctx.fillText(char, 0, 0);
        ctx.restore();
      }
    }
  }
}

/**
 * Draw a page and hand back the picture, once.
 *
 * This is what makes the front page's strip free to look at: a moderator
 * choosing a page runs this in their browser and uploads the result, and every
 * visitor afterwards gets an image instead of a canvas redrawn from 960 cells.
 *
 * At natural size, so nothing is snapped away — a picture stored once is the
 * one place there is no reason to economise on pixels.
 */
export async function renderPageBlob(
  page: TeletextPage,
  options: DrawPageOptions = {},
  type: string = 'image/png',
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (ctx == null) return null;

  // The webfont has to be present before the glyphs are drawn: canvas text
  // keeps whatever font existed at draw time, and this drawing is kept.
  try {
    await document.fonts?.ready;
  } catch {
    /* draw with whatever is available rather than not at all */
  }

  drawPage(ctx, page, options);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

/** A blob as the bare base64 the showcase endpoint expects. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  // Chunked: `String.fromCharCode(...bytes)` on a few hundred kilobytes blows
  // the argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
