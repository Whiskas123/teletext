/**
 * What is actually on a SIC render, structurally.
 *
 * Before adding a render profile it is worth proving the cell grid, rather than
 * inferring it from the fact that the dimensions divide evenly. If the grid is
 * right, an ink map of the page reads as words; if it is off by a pixel, the
 * same map reads as noise and every stencil derived from it would be junk.
 *
 *     bun run scripts/probeSicLayout.ts [path]
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { TELETEXT_COLORS, TELETEXT_COLOR_HEX } from '../src/types/teletext';
import { loadImageNode } from './lib/loadImageNode';

const ROOT = join(import.meta.dirname, '..');

const PALETTE = TELETEXT_COLORS.map((color) => {
  const hex = TELETEXT_COLOR_HEX[color];
  return (
    (Number.parseInt(hex.slice(1, 3), 16) << 16) |
    (Number.parseInt(hex.slice(3, 5), 16) << 8) |
    Number.parseInt(hex.slice(5, 7), 16)
  );
});

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (/\.(gif|png)$/i.test(entry.name)) out.push(path);
  }
  return out;
}

async function main(): Promise<void> {
  let path = process.argv[2];
  if (path == null) {
    const all = await walk(join(ROOT, 'archive-corpus-sic'));
    for (const candidate of all) {
      const probe = await loadImageNode(candidate);
      if (probe.width === 320 && probe.height === 240) {
        path = candidate;
        break;
      }
    }
  }
  if (path == null) throw new Error('No 320x240 SIC image found.');

  const pixels = await loadImageNode(path);
  const { width, height } = pixels;
  const cellW = width / 40;
  const cellH = height / 24;

  console.log(`${path.slice(ROOT.length + 1)}`);
  console.log(`${width}x${height} -> 40 x 24 cells of ${cellW}x${cellH}\n`);

  const rgbAt = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
  };

  // Which palette colours appear at all, and how often.
  const colourCount = new Map<number, number>();
  let offPalette = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = rgbAt(x, y);
      if (!PALETTE.includes(rgb)) offPalette += 1;
      colourCount.set(rgb, (colourCount.get(rgb) ?? 0) + 1);
    }
  }
  console.log(`off-palette pixels: ${offPalette}`);
  console.log(
    'colours: ' +
      [...colourCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([rgb, n]) => {
          const idx = PALETTE.indexOf(rgb);
          const name = idx === -1 ? `#${rgb.toString(16).padStart(6, '0')}` : TELETEXT_COLORS[idx];
          return `${name}=${n}`;
        })
        .join(' '),
  );

  // The ink map: one character per cell. If the grid is right this reads as
  // text, with word gaps and a left margin.
  console.log('\nink map (# = cell has more than one colour):');
  console.log('    ' + '0123456789'.repeat(4));
  for (let row = 0; row < 24; row += 1) {
    let line = '';
    for (let col = 0; col < 40; col += 1) {
      const seen = new Set<number>();
      for (let y = 0; y < cellH; y += 1) {
        for (let x = 0; x < cellW; x += 1) {
          seen.add(rgbAt(col * cellW + x, row * cellH + y));
        }
      }
      line += seen.size > 1 ? '#' : seen.has(PALETTE[0]) ? '.' : ':';
    }
    console.log(String(row).padStart(3) + ' ' + line);
  }

  // Full-height background rows tell us whether a row is structural padding.
  console.log('\nrow backgrounds (dominant colour per text row):');
  for (let row = 0; row < 24; row += 1) {
    const counts = new Map<number, number>();
    for (let y = 0; y < cellH; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rgb = rgbAt(x, row * cellH + y);
        counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
      }
    }
    const [dominant] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const idx = PALETTE.indexOf(dominant);
    console.log(
      `  row ${String(row).padStart(2)}: ${
        idx === -1 ? 'off-palette' : TELETEXT_COLORS[idx]
      }`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
