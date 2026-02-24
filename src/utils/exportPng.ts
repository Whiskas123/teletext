import type { SixelColors, TeletextPage } from '../types/teletext';
import { sixelBit } from '../types/teletext';

const COLOR_HEX: Record<string, string> = {
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  yellow: '#ffff00',
  blue: '#0000ff',
  magenta: '#ff00ff',
  cyan: '#00ffff',
  white: '#ffffff',
};

const COLS = 40;
const ROWS = 24;
const CELL_W = 14;
const CELL_H = 18;
const FONT = '14px "European Teletext", "Courier New", Courier, monospace';

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
  bg: string
) {
  const w = CELL_W / 2;
  const h = CELL_H / 3;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, CELL_W, CELL_H);
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

/**
 * Export the teletext page as a PNG and trigger download.
 * Includes header line (page number + date/time) and index line (INDEX, TV GUIDE, WORLD, FINANCE).
 */
export function exportPageAsPng(
  page: TeletextPage,
  filename = 'teletext.png',
  pageNumber = 100
): void {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.font = FONT;
  ctx.textBaseline = 'top';

  const now = new Date();
  const pageStr = formatPageNumber(pageNumber);
  const dateTimeStr = formatHeaderDateTime(now);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const cell = page[index];
      let bg = COLOR_HEX[cell.bg] ?? '#000000';
      let fg = COLOR_HEX[cell.fg] ?? '#ffffff';
      let char = cell.char === ' ' ? '\u00a0' : cell.char;
      const x = col * CELL_W;
      const y = row * CELL_H;

      if (row === 0) {
        if (col < 3) {
          char = pageStr[col];
          fg = '#ffffff';
        } else if (col >= 20) {
          char = dateTimeStr[col - 20];
          fg = '#ffff00';
        }
      } else if (row === ROWS - 1) {
        for (const { start, end, label, fg: indexFg } of INDEX_LINE_RANGES) {
          if (col >= start && col < end) {
            char = label[col - start];
            fg = COLOR_HEX[indexFg] ?? fg;
            break;
          }
        }
        if (col < 40 && !INDEX_LINE_RANGES.some((r) => col >= r.start && col < r.end)) {
          char = '\u00a0';
        }
      }

      const isGraphics =
        row !== 0 &&
        row !== ROWS - 1 &&
        typeof cell.graphics === 'number' &&
        cell.graphics >= 0 &&
        cell.graphics <= 63;
      if (isGraphics) {
        drawSixel(ctx, x, y, cell.graphics! & 0x3f, cell.graphicsColors, fg, bg);
      } else {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL_W, CELL_H);
        ctx.fillStyle = fg;
        ctx.fillText(char, x, y);
      }
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
