/**
 * Reconstruct the single-height stencils of characters that only ever appear
 * double-height, so they can be transcribed into the atlas.
 *
 *     bun run scripts/sicDoubleHeight.ts 480x336 [perRow]
 *
 * ## Why this is needed
 *
 * The decoder reads a double-height line by un-doubling both halves of each
 * pair and looking the reconstructed glyph up in the atlas — so double height
 * costs the atlas nothing, and a character learnt at normal height is known at
 * both. The catch is the direction of that dependency: reconstruction needs the
 * atlas to already hold the character.
 *
 * On SIC's 480x336 pages the section headings are the only place several
 * capitals appear, and they are all double-height. Those letters therefore have
 * no single-height occurrence anywhere in the corpus to read them off, and each
 * surfaces as two unrelated half-stencils that must not be transcribed
 * individually.
 *
 * This does offline what the decoder does at run time: finds adjacent
 * row-doubled pairs, un-doubles each half, joins them, and pools the results.
 * The output is the real single-height stencil, ready to read and put in the
 * atlas — after which the decoder resolves the headings on its own.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { glyphKey, RENDER_PROFILES } from '../src/domain/archiveImport';
import { COLS, TELETEXT_COLORS, TELETEXT_COLOR_HEX } from '../src/types/teletext';
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
  const sizeArg = process.argv[2] ?? '480x336';
  const perRow = Number(process.argv[3] ?? 8);
  const profile = RENDER_PROFILES.find((p) => p.name === sizeArg);
  if (profile == null) throw new Error(`No profile named ${sizeArg}.`);
  const [wantWidth, wantHeight] = sizeArg.split('x').map(Number);
  const { cellWidth, cellHeight, sourceRows } = profile;

  const found = new Map<string, { bitmap: boolean[][]; count: number }>();
  let scanned = 0;

  for (const path of await walk(join(ROOT, 'archive-corpus-sic'))) {
    let pixels;
    try {
      pixels = await loadImageNode(path);
    } catch {
      continue;
    }
    if (pixels.width !== wantWidth || pixels.height !== wantHeight) continue;
    scanned += 1;

    const rgbAt = (x: number, y: number): number => {
      const i = (y * pixels.width + x) * 4;
      return (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
    };

    /** Whether the cell's rows come in identical pairs. */
    const rowDoubled = (ox: number, oy: number): boolean => {
      for (let pair = 0; pair < Math.floor(cellHeight / 2); pair += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          if (rgbAt(ox + x, oy + pair * 2) !== rgbAt(ox + x, oy + pair * 2 + 1)) {
            return false;
          }
        }
      }
      return true;
    };

    // Consume pairs the way the decoder does: once (row, row+1) is taken as a
    // double-height pair, row+1 is spent. Without this, the bottom half of one
    // pair and the top half of the next also look like a valid pair, and the
    // resulting stencil is two unrelated halves spliced together — which is
    // most of what an unguarded scan finds.
    const consumed = new Set<number>();

    for (let row = 0; row + 1 < sourceRows; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (consumed.has(row * COLS + col)) continue;
        const ox = col * cellWidth;
        const topY = row * cellHeight;
        const bottomY = topY + cellHeight;
        if (!rowDoubled(ox, topY) || !rowDoubled(ox, bottomY)) continue;

        // Both halves must carry ink. A blank cell is trivially row-doubled, so
        // without this a blank row pairs with the top half of the glyph below
        // it, consumes that row, and the real pair never forms — producing a
        // stencil holding half a letter, and starving the true one.
        const hasInk = (oy: number): boolean => {
          const first = rgbAt(ox, oy);
          for (let y = 0; y < cellHeight; y += 1) {
            for (let x = 0; x < cellWidth; x += 1) {
              if (rgbAt(ox + x, oy + y) !== first) return true;
            }
          }
          return false;
        };
        if (!hasInk(topY) || !hasInk(bottomY)) continue;

        // Collect the two colours across both halves; anything else is not a
        // two-colour character cell.
        const counts = new Map<number, number>();
        const lines: number[][] = [];
        for (const y0 of [topY, bottomY]) {
          for (let pair = 0; pair < cellHeight / 2; pair += 1) {
            const line: number[] = [];
            for (let x = 0; x < cellWidth; x += 1) {
              const rgb = rgbAt(ox + x, y0 + pair * 2);
              line.push(rgb);
              counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
            }
            lines.push(line);
          }
        }
        if (counts.size !== 2) continue;
        if ([...counts.keys()].some((rgb) => !PALETTE.includes(rgb))) continue;

        // Ink is the rarer of the two, as elsewhere in the decoder.
        const [background] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const bitmap = lines.map((line) => line.map((rgb) => rgb !== background));

        // A blank pair is not a character.
        if (bitmap.every((line) => line.every((ink) => !ink))) continue;

        consumed.add((row + 1) * COLS + col);

        const key = glyphKey(bitmap);
        const existing = found.get(key);
        if (existing == null) found.set(key, { bitmap, count: 1 });
        else existing.count += 1;
      }
    }
  }

  /**
   * Whether every row is one of the four shapes a block-graphics cell can draw
   * — empty, full, or either half of the sixel split. Those cells are
   * recognised structurally by the decoder and are never atlas entries; they
   * dominate an unfiltered scan because a solid block is trivially row-doubled.
   */
  const split = profile.sixelX[1];
  const isSixelShaped = (bitmap: readonly (readonly boolean[])[]): boolean =>
    bitmap.every((row) => {
      const left = row.slice(0, split);
      const right = row.slice(split);
      const uniform = (part: readonly boolean[]): boolean =>
        part.every((ink) => ink) || part.every((ink) => !ink);
      return uniform(left) && uniform(right);
    });

  const ranked = [...found.entries()]
    .filter(([, entry]) => !isSixelShaped(entry.bitmap))
    .sort((a, b) => b[1].count - a[1].count);
  console.error(
    `Scanned ${scanned} images at ${sizeArg}; ${ranked.length} reconstructed ` +
      'double-height stencils.',
  );

  for (let start = 0; start < ranked.length; start += perRow) {
    const group = ranked.slice(start, start + perRow);
    console.log(
      group
        .map((_, i) => String(start + i).padStart(3, ' ').padEnd(cellWidth + 2, ' '))
        .join(''),
    );
    for (let y = 0; y < cellHeight; y += 1) {
      console.log(
        group
          .map(([, e]) => e.bitmap[y].map((ink) => (ink ? '#' : '.')).join('') + '  ')
          .join(''),
      );
    }
    console.log('');
  }

  console.log('--- KEYS (same order) ---');
  for (const [index, [key, entry]] of ranked.entries()) {
    console.log(`${index}\t${key}\t${entry.count}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
