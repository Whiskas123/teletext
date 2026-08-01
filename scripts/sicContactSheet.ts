/**
 * The unrecognised SIC stencils as a contact sheet: many glyphs side by side,
 * numbered, so a whole alphabet can be read in a few screens instead of one
 * stencil per screen.
 *
 *     bun run scripts/sicContactSheet.ts 320x240 [perRow] [sampleSize]
 *
 * Prints the drawings first, then the keys in the same order, so the reading
 * and the transcription can be done separately: read the sheet, write out the
 * characters in order, and `applySicAtlas.ts` pairs them back up with the keys.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { importArchiveImage, RENDER_PROFILES } from '../src/domain/archiveImport';
import { loadImageNode } from './lib/loadImageNode';

const ROOT = join(import.meta.dirname, '..');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (/\.(gif|png)$/i.test(entry.name)) out.push(path);
  }
  return out;
}

function isBlockGraphics(bitmap: readonly (readonly boolean[])[]): boolean {
  return bitmap.every((row) => row.every((ink) => ink) || row.every((ink) => !ink));
}

/**
 * Whether every row is repeated — the mark of one half of a double-height
 * line, which the renderer draws by doubling each source row.
 *
 * These must not be transcribed. The decoder reconstructs a double-height pair
 * by un-doubling both halves and looking the result up in the atlas, so once
 * the base characters are in, these resolve on their own. Adding them as
 * entries would file a half-glyph under a character.
 *
 * They only show up here because an empty atlas makes every lookup fail,
 * including the one double-height detection itself depends on.
 */
function isRowDoubled(bitmap: readonly (readonly boolean[])[]): boolean {
  for (let pair = 0; pair + 1 < bitmap.length; pair += 2) {
    const a = bitmap[pair];
    const b = bitmap[pair + 1];
    if (a.some((ink, x) => ink !== b[x])) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const sizeArg = process.argv[2] ?? '320x240';
  const perRow = Number(process.argv[3] ?? 8);
  const sampleSize = Number(process.argv[4] ?? Number.MAX_SAFE_INTEGER);
  // Pass `--doubled` to keep the double-height filter on, for the first pass
  // against an empty atlas.
  const filterDoubled = process.argv.includes('--doubled');

  const profile = RENDER_PROFILES.find((p) => p.name === sizeArg);
  if (profile == null) throw new Error(`No profile named ${sizeArg}.`);
  const [wantWidth, wantHeight] = sizeArg.split('x').map(Number);

  const files = await walk(join(ROOT, 'archive-corpus-sic'));
  const stencils = new Map<string, { bitmap: boolean[][]; count: number }>();

  let scanned = 0;
  for (const path of files) {
    if (scanned >= sampleSize) break;
    let pixels;
    try {
      pixels = await loadImageNode(path);
    } catch {
      continue;
    }
    if (pixels.width !== wantWidth || pixels.height !== wantHeight) continue;
    try {
      for (const glyph of importArchiveImage(pixels).unknownGlyphs) {
        const existing = stencils.get(glyph.key);
        if (existing == null) {
          stencils.set(glyph.key, { bitmap: glyph.bitmap, count: glyph.cells.length });
        } else {
          existing.count += glyph.cells.length;
        }
      }
    } catch {
      continue;
    }
    scanned += 1;
  }

  const ranked = [...stencils.entries()]
    // Row-doubled stencils are excluded only while the atlas is still empty:
    // with nothing to look up, double-height detection fails and both halves
    // surface here as if they were characters. Once the atlas has the base
    // glyphs the decoder resolves them itself, and the filter must come off —
    // it also catches genuinely symmetric characters such as the full stop,
    // whose two ink rows are identical.
    .filter(
      ([, entry]) =>
        !isBlockGraphics(entry.bitmap) &&
        (!filterDoubled || !isRowDoubled(entry.bitmap)),
    )
    .sort((a, b) => b[1].count - a[1].count);

  console.error(`Scanned ${scanned} images; ${ranked.length} character stencils.`);

  const cellHeight = profile.cellHeight;

  for (let start = 0; start < ranked.length; start += perRow) {
    const group = ranked.slice(start, start + perRow);

    // Index labels above each drawing.
    console.log(
      group
        .map((_, i) => String(start + i).padStart(3, ' ').padEnd(profile.cellWidth + 2, ' '))
        .join(''),
    );

    for (let y = 0; y < cellHeight; y += 1) {
      console.log(
        group
          .map(([, entry]) =>
            entry.bitmap[y].map((ink) => (ink ? '#' : '.')).join('') + '  ',
          )
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
