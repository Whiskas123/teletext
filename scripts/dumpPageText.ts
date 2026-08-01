/**
 * Decode a corpus render and print it as text.
 *
 *     bun run scripts/dumpPageText.ts <path>
 *
 * The check an atlas actually needs. A stencil transcribed wrongly still
 * produces a clean-looking import — the page decodes, no glyph is reported
 * unknown, and the error only shows as one wrong letter inside otherwise
 * correct words. Reading the page back as prose catches that immediately, in a
 * way that counting unknown glyphs never will.
 *
 * Unknown characters print as `¿`, block graphics as `▓`.
 */

import { importArchiveImage } from '../src/domain/archiveImport';
import { COLS, ROWS } from '../src/types/teletext';
import { loadImageNode } from './lib/loadImageNode';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path == null) throw new Error('Usage: dumpPageText.ts <path>');

  const result = importArchiveImage(await loadImageNode(path));

  console.log(
    `profile ${result.profile.name}  dropped-row ${String(result.droppedRow)}  ` +
      `unknown ${result.unknownGlyphs.length}  snapped ${result.snappedPixels}`,
  );
  console.log('    ' + '0123456789'.repeat(4));

  for (let row = 0; row < ROWS; row += 1) {
    let line = '';
    for (let col = 0; col < COLS; col += 1) {
      const cell = result.page[row * COLS + col];
      if (cell.graphics != null) line += '▓';
      else if (cell.char === '�') line += '¿';
      else line += cell.char;
    }
    console.log(String(row).padStart(3) + ' ' + line.replace(/\s+$/, ''));
  }

  if (result.unknownGlyphs.length > 0) {
    console.log(`\n${result.unknownGlyphs.length} unknown stencil(s):`);
    for (const glyph of result.unknownGlyphs.slice(0, 8)) {
      console.log(`  ${glyph.key}  (${glyph.cells.length} cells)`);
      for (const line of glyph.bitmap) {
        console.log('    ' + line.map((ink) => (ink ? '#' : '.')).join(''));
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
