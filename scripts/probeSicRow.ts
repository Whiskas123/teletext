/**
 * Print one text row of a SIC render, cell by cell, as ASCII art.
 *
 * The decisive check on a proposed cell grid: if the grid is right the row is
 * legible as words, and the stencils can be read off it to build an atlas. If
 * it is off by a pixel, characters come out sheared and nothing is readable.
 *
 *     bun run scripts/probeSicRow.ts <path> <row> [cellW] [cellH]
 */

import { loadImageNode } from './lib/loadImageNode';

async function main(): Promise<void> {
  const path = process.argv[2];
  const row = Number(process.argv[3] ?? 5);
  const cellW = Number(process.argv[4] ?? 8);
  const cellH = Number(process.argv[5] ?? 10);
  if (path == null) throw new Error('Usage: probeSicRow.ts <path> <row>');

  const pixels = await loadImageNode(path);
  const { width } = pixels;

  const rgbAt = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
  };

  // Background is the most common colour across the whole row of pixels.
  const counts = new Map<number, number>();
  for (let y = 0; y < cellH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = rgbAt(x, row * cellH + y);
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    }
  }
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Print the row as `cellH` lines, cells separated by a space, so each glyph
  // is visually isolated and can be read straight off.
  const columns = Math.floor(width / cellW);
  for (let y = 0; y < cellH; y += 1) {
    let line = '';
    for (let col = 0; col < columns; col += 1) {
      for (let x = 0; x < cellW; x += 1) {
        line += rgbAt(col * cellW + x, row * cellH + y) === background ? '.' : '#';
      }
      line += ' ';
    }
    console.log(line);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
