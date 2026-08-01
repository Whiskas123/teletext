/**
 * Pair transcribed characters with their stencil keys and write an atlas file.
 *
 *     bun run scripts/applySicAtlas.ts <keys.tsv> <chars.txt> <out.ts> <exportName> <cellSize>
 *
 * `keys.tsv` is `index<TAB>key<TAB>count`, as printed by `sicContactSheet.ts`.
 * `chars.txt` is one character per line, in the same order — the transcription.
 *
 * A line of `?SKIP` leaves that stencil out. Deliberately supported: a stencil
 * nobody could read with confidence is better left unknown, where the import
 * screen will ask about it, than guessed at — a wrong entry silently mis-spells
 * that character on every page it appears in, and looks like a correct import.
 */

import { readFile, writeFile } from 'node:fs/promises';

const SKIP = '?SKIP';

async function main(): Promise<void> {
  const [keysPath, charsPath, outPath, exportName, cellSize] = process.argv.slice(2);
  if (keysPath == null || charsPath == null || outPath == null || exportName == null) {
    throw new Error(
      'Usage: applySicAtlas.ts <keys.tsv> <chars.txt> <out.ts> <exportName> <cellSize>',
    );
  }

  const keyLines = (await readFile(keysPath, 'utf8')).split('\n').filter((l) => l.trim());
  const charLines = (await readFile(charsPath, 'utf8')).split('\n');
  // A trailing newline is normal; anything more is a real length mismatch.
  while (charLines.length > 0 && charLines[charLines.length - 1] === '') charLines.pop();

  if (keyLines.length !== charLines.length) {
    throw new Error(
      `${keyLines.length} keys but ${charLines.length} characters — the two ` +
        'files must line up index for index.',
    );
  }

  const entries: { key: string; char: string; count: number }[] = [];
  let skipped = 0;

  for (const [i, line] of keyLines.entries()) {
    const [, key, count] = line.split('\t');
    const char = charLines[i];
    if (char === SKIP || char === '') {
      skipped += 1;
      continue;
    }
    if (char.length !== 1) {
      throw new Error(`Line ${i}: expected one character, got ${JSON.stringify(char)}`);
    }
    entries.push({ key, char, count: Number(count) });
  }

  // Two stencils legitimately map to one character (the corpus spans render
  // eras with slightly different weights), but one stencil mapping to two
  // characters is a transcription error.
  const seen = new Map<string, string>();
  for (const { key, char } of entries) {
    const previous = seen.get(key);
    if (previous != null && previous !== char) {
      throw new Error(`Stencil ${key} transcribed as both ${previous} and ${char}`);
    }
    seen.set(key, char);
  }

  const escape = (char: string): string =>
    char === "'" ? "\\'" : char === '\\' ? '\\\\' : char;

  const body = entries
    .map(({ key, char, count }) => `  '${key}': '${escape(char)}', // ${count}x`)
    .join('\n');

  const header = `/**
 * Glyph atlas for SIC's ${cellSize} renderer — see \`domain/archiveImport.ts\`.
 *
 * SIC's font is not RTP's: at 8x10 the cells are the same size as RTP's
 * 320x250 renderer, but not one stencil matched \`GLYPH_ATLAS_8X10\` — SIC draws
 * with two-pixel stems where RTP draws with one, so every character is a
 * different bitmap and needs its own entry.
 *
 * ## Key format
 *
 * One group of 4 hex digits per pixel row, most significant bit leftmost, as
 * produced by \`glyphKey\` in \`domain/archiveImport.ts\`.
 *
 * ## How this was built
 *
 * \`scripts/sicContactSheet.ts\` pools every stencil the decoder could not place
 * across the corpus, ordered by how often it appears, and draws each one. The
 * characters were read off those drawings and paired back up by
 * \`scripts/applySicAtlas.ts\`. Comments give the number of cells each stencil
 * accounts for.
 *
 * Two things are deliberately absent. **Block graphics** are recognised
 * structurally by the decoder and never looked up here. **Double-height
 * halves** are reconstructed by un-doubling both halves and looking up the
 * result, so they resolve once the base characters are present; filing a half
 * glyph here would be a bug.
 *
 * ${skipped} stencil(s) were left out as unreadable. They surface on the import
 * screen as unknown glyphs, which is the honest outcome — a guessed entry would
 * mis-spell that character on every page and still look like a clean import.
 */

export const ${exportName}: Record<string, string> = {
${body}
};
`;

  await writeFile(outPath, header, 'utf8');
  console.log(
    `Wrote ${entries.length} glyphs to ${outPath} (${skipped} skipped as unreadable).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
