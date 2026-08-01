/**
 * Check that decoding a corpus image in Node matches decoding it in a browser.
 *
 * The batch import swaps the app's canvas-based pixel loader for libvips
 * (`scripts/lib/loadImageNode.ts`). That swap is the one place the import could
 * go wrong invisibly: a decoder that shifts a flat colour by a digit still
 * produces a page, just a subtly wrong one, and it would do so 3,000 times
 * before anyone noticed.
 *
 * Two checks, run before any import:
 *
 * 1. **Exact, against browser-derived ground truth.** `archiveImport.fixtures`
 *    holds the palette index of every pixel of two real GIFs, captured through
 *    the browser path and verified by hand. Decoding the same GIFs with libvips
 *    must reproduce those indices exactly.
 * 2. **Broad, against the decoder's own invariant.** `importArchiveImage`
 *    counts pixels that were not exactly a palette colour. Across a random
 *    sample of the corpus that count must stay zero — if libvips colour-managed
 *    or resampled anything, it could not.
 *
 *     bun run scripts/verifyDecoder.ts [sampleSize]
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  importArchiveImage,
  type SourcePixels,
} from '../src/domain/archiveImport';
import { SAMPLE_163, SAMPLE_198 } from '../src/domain/archiveImport.fixtures';
import { TELETEXT_COLORS, TELETEXT_COLOR_HEX } from '../src/types/teletext';
import { loadImageNode } from './lib/loadImageNode';

const ROOT = join(import.meta.dirname, '..');

/** RGB triples for the palette, in `TELETEXT_COLORS` order. */
const PALETTE_RGB = TELETEXT_COLORS.map((color) => {
  const hex = TELETEXT_COLOR_HEX[color];
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
});

/**
 * Expand a fixture's run-length encoding into the palette index of every pixel.
 * Mirrors the format documented in `archiveImport.fixtures.ts`: comma-separated
 * runs of one palette digit followed by a base-36 run length.
 */
function expandRle(rle: string): Uint8Array {
  const runs = rle.split(',');
  const out: number[] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    const index = Number.parseInt(run[0], 10);
    const length = Number.parseInt(run.slice(1), 36);
    for (let i = 0; i < length; i += 1) out.push(index);
  }
  return Uint8Array.from(out);
}

/** The palette index of every pixel of `pixels`, or `null` at the first miss. */
function paletteIndices(
  pixels: SourcePixels,
): { indices: Uint8Array } | { error: string } {
  const count = pixels.width * pixels.height;
  const indices = new Uint8Array(count);

  for (let i = 0; i < count; i += 1) {
    const r = pixels.data[i * 4];
    const g = pixels.data[i * 4 + 1];
    const b = pixels.data[i * 4 + 2];
    const found = PALETTE_RGB.findIndex(
      ([pr, pg, pb]) => pr === r && pg === g && pb === b,
    );
    if (found === -1) {
      const x = i % pixels.width;
      const y = Math.floor(i / pixels.width);
      return {
        error:
          `pixel (${x}, ${y}) is rgb(${r}, ${g}, ${b}), which is not a ` +
          'palette colour — libvips altered the image',
      };
    }
    indices[i] = found;
  }

  return { indices };
}

/** Check one fixture against the real GIF it was taken from. */
async function checkFixture(
  sample: { name: string; rle: string },
  path: string,
): Promise<boolean> {
  const pixels = await loadImageNode(path);
  const expected = expandRle(sample.rle);

  if (pixels.width * pixels.height !== expected.length) {
    console.error(
      `  FAIL ${sample.name}: got ${pixels.width}x${pixels.height} ` +
        `(${pixels.width * pixels.height} px), fixture has ${expected.length} px`,
    );
    return false;
  }

  const actual = paletteIndices(pixels);
  if ('error' in actual) {
    console.error(`  FAIL ${sample.name}: ${actual.error}`);
    return false;
  }

  for (let i = 0; i < expected.length; i += 1) {
    if (actual.indices[i] !== expected[i]) {
      const x = i % pixels.width;
      const y = Math.floor(i / pixels.width);
      console.error(
        `  FAIL ${sample.name}: pixel (${x}, ${y}) is ` +
          `${TELETEXT_COLORS[actual.indices[i]]}, fixture says ` +
          `${TELETEXT_COLORS[expected[i]]}`,
      );
      return false;
    }
  }

  console.log(`  ok   ${sample.name} — ${expected.length} pixels identical`);
  return true;
}

/** Every image file under a corpus directory, as absolute paths. */
async function corpusImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(gif|png)$/i.test(entry.name)) out.push(path);
    }
  };
  await walk(dir);
  return out;
}

async function main(): Promise<void> {
  const sampleSize = Number(process.argv[2] ?? 40);
  let ok = true;

  console.log('Fixture cross-check (browser-derived ground truth):');
  ok =
    (await checkFixture(
      SAMPLE_163,
      join(ROOT, 'archive-corpus-rtp/eventos/expo-98/163-01_19980615102452.gif'),
    )) && ok;

  // The second fixture's source is located by name rather than hardcoded, since
  // it sits in whichever topic folder the classifier put it in.
  const rtpImages = await corpusImages(join(ROOT, 'archive-corpus-rtp'));
  const sample198 = rtpImages.find((path) => path.includes('/198-01_'));
  if (sample198 == null) {
    console.error('  SKIP 198-01.gif — not found in archive-corpus-rtp');
  } else {
    ok = (await checkFixture(SAMPLE_198, sample198)) && ok;
  }

  console.log(`\nCorpus sample (${sampleSize} images, expecting 0 snapped pixels):`);
  const sicImages = await corpusImages(join(ROOT, 'archive-corpus-sic'));
  const all = [...rtpImages, ...sicImages];
  const step = Math.max(1, Math.floor(all.length / sampleSize));
  const chosen = all.filter((_, i) => i % step === 0).slice(0, sampleSize);

  let snappedTotal = 0;
  let unknownTotal = 0;
  let failures = 0;

  for (const path of chosen) {
    try {
      const result = importArchiveImage(await loadImageNode(path));
      snappedTotal += result.snappedPixels;
      unknownTotal += result.unknownGlyphs.length;
      if (result.snappedPixels > 0) {
        console.error(
          `  FAIL ${path.slice(ROOT.length + 1)}: ${result.snappedPixels} snapped pixels`,
        );
        failures += 1;
      }
    } catch (error) {
      console.error(
        `  FAIL ${path.slice(ROOT.length + 1)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      failures += 1;
    }
  }

  console.log(
    `  ${chosen.length - failures}/${chosen.length} decoded cleanly, ` +
      `${snappedTotal} snapped pixels, ${unknownTotal} unknown glyphs`,
  );

  if (snappedTotal > 0 || failures > 0) ok = false;

  console.log(
    ok
      ? '\nlibvips and the browser agree. Safe to import.'
      : '\nDecoder mismatch — do NOT run the import until this is resolved.',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
