/**
 * A page reduced to one colour per cell, for the archive browser's thumbnails.
 *
 * The browser shows sixty captures at a time and each full page is ~59 KB of
 * cells, so sending real pages would be three and a half megabytes per screen
 * of results to draw sixty postage stamps. Rendering them would be worse:
 * sixty `TeletextGrid`s is 57,600 DOM nodes.
 *
 * So a thumbnail is {@link TOTAL_CELLS} characters, one palette digit per cell —
 * 960 bytes, about 1.6% of the page. The client draws it to a 40x24 canvas and
 * scales that up with `image-rendering: pixelated`, which is both cheap and an
 * honest likeness: teletext is already a grid of flat colours, so a
 * one-colour-per-cell reduction loses the glyph shapes and nothing else. At
 * thumbnail size the glyphs were never legible anyway; what you actually
 * recognise a page by is its layout and colour, and that survives intact.
 *
 * Stored on the row at import time rather than derived on read: deriving it
 * would mean fetching every page's full cells to build a list that exists
 * precisely to avoid that.
 */

import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';
import { normalizePage } from './pageOps';

/** Palette index of a colour, as the digit used in a thumbnail string. */
function paletteIndex(color: TeletextColor): number {
  const index = TELETEXT_COLORS.indexOf(color);
  return index === -1 ? 0 : index;
}

/**
 * The one colour that best stands for a cell.
 *
 * Graphics take the most common of their six sub-cell colours, since that is
 * what the block reads as from a distance. A cell with ink takes its foreground
 * — text is what the eye picks out of a layout. Everything else is its
 * background.
 */
function dominantColor(cell: Cell): TeletextColor {
  if (cell.graphics != null && cell.graphics !== 0) {
    const colors = cell.graphicsColors;
    if (colors != null) {
      const counts = new Map<TeletextColor, number>();
      for (let bit = 0; bit < 6; bit += 1) {
        // Only sub-cells the pattern actually fills contribute; the rest show
        // the background.
        const on = ((cell.graphics >> bit) & 1) === 1;
        const color = on ? colors[bit] : cell.bg;
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
      let best: TeletextColor = cell.bg;
      let bestCount = -1;
      for (const [color, count] of counts) {
        if (count > bestCount) {
          best = color;
          bestCount = count;
        }
      }
      return best;
    }
  }

  if (cell.char !== ' ' && cell.char !== '') return cell.fg;
  return cell.bg;
}

/**
 * Encode a page as {@link TOTAL_CELLS} palette digits, row-major.
 *
 * Always exactly that length, whatever it is handed, so the client can index
 * into it by cell without bounds checks.
 */
export function encodeThumbnail(page: unknown): string {
  const cells = normalizePage(page);
  let out = '';
  for (let i = 0; i < TOTAL_CELLS; i += 1) {
    out += String(paletteIndex(dominantColor(cells[i])));
  }
  return out;
}

/** Whether `value` is a well-formed thumbnail string. */
export function isThumbnail(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-7]{${TOTAL_CELLS}}$`).test(value);
}

/**
 * Decode to palette indices for drawing. Returns `null` for anything malformed,
 * so a bad row shows no thumbnail rather than a misleading one.
 */
export function decodeThumbnail(value: unknown): Uint8Array | null {
  if (!isThumbnail(value)) return null;
  const out = new Uint8Array(TOTAL_CELLS);
  for (let i = 0; i < TOTAL_CELLS; i += 1) out[i] = value.charCodeAt(i) - 48;
  return out;
}

/** Convenience for callers holding a real page. */
export function thumbnailOf(page: TeletextPage): string {
  return encodeThumbnail(page);
}
