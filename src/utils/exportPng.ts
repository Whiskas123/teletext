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
const FONT = '14px "Press Start 2P", "Courier New", Courier, monospace';

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
 */
export function exportPageAsPng(page: TeletextPage, filename = 'teletext.png'): void {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.font = FONT;
  ctx.textBaseline = 'top';

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const cell = page[index];
      const bg = COLOR_HEX[cell.bg] ?? '#000000';
      const fg = COLOR_HEX[cell.fg] ?? '#ffffff';
      const x = col * CELL_W;
      const y = row * CELL_H;
      const isGraphics = typeof cell.graphics === 'number' && cell.graphics >= 0 && cell.graphics <= 63;
      if (isGraphics) {
        drawSixel(ctx, x, y, cell.graphics! & 0x3f, cell.graphicsColors, fg, bg);
      } else {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL_W, CELL_H);
        ctx.fillStyle = fg;
        ctx.fillText(cell.char === ' ' ? '\u00a0' : cell.char, x, y);
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
