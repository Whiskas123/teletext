/**
 * Translate live pages to English and print both side by side.
 *
 *     bun run --env-file=.env.local scripts/translatePage.ts 101 220 300.2
 *
 * The experiment before SUB gets a key on the remote: does English squeezed
 * into the cells the Portuguese occupied still read well? Nothing is written
 * anywhere — each page is read from `live_pages`, cut into runs
 * (`src/domain/subtitles.ts`), sent to Claude in one request so it sees the
 * whole page as context, and printed.
 *
 * Needs `DATABASE_URL` and `ANTHROPIC_API_KEY`. Runs that came back too long
 * for their cells are listed under the page, with the full English, because a
 * clipped word looks like a typo and would otherwise be judged as one; so are
 * runs whose English lost a number, which the site would refuse.
 */

import { db } from '../api/_lib/db';
import { TRANSLATION_PRICE as PRICE, translateRuns } from '../api/_lib/translate';
import { pageToArray } from '../src/domain/pageEncoding';
import { parsePageKey } from '../src/domain/subpages';
import { applySubtitles, keepsNumbers, subtitleRuns } from '../src/domain/subtitles';
import { COLS, ROWS, type TeletextPage } from '../src/types/teletext';

function usage(): never {
  console.error('Usage: translatePage.ts <page>[.<subpage>] ...   e.g. 101 220 300.2');
  process.exit(1);
}

async function loadPage(pageNumber: number, subpage: number): Promise<TeletextPage | null> {
  const rows = await db()`
    select cells from live_pages where page_number = ${pageNumber} and subpage = ${subpage}
  `;
  return rows.length === 0 ? null : pageToArray(rows[0].cells);
}

/** One row as it shows on screen, block graphics as ▓, padded to 40. */
function line(page: TeletextPage, row: number): string {
  let out = '';
  for (let col = 0; col < COLS; col += 1) {
    const cell = page[row * COLS + col];
    out += cell.graphics != null ? '▓' : cell.char === '' ? ' ' : cell.char;
  }
  return out;
}

function printSideBySide(key: string, before: TeletextPage, after: TeletextPage): void {
  const ruler = '0123456789'.repeat(4);
  console.log(`\n── ${key} ${'─'.repeat(80)}`);
  console.log(`    ${ruler.padEnd(COLS)}  │ ${ruler}`);
  for (let row = 0; row < ROWS; row += 1) {
    console.log(`${String(row).padStart(3)} ${line(before, row)}  │ ${line(after, row)}`);
  }
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2);
  if (keys.length === 0) usage();
  let inputTokens = 0;
  let outputTokens = 0;

  for (const key of keys) {
    const parsed = parsePageKey(key);
    if (parsed == null) usage();
    const page = await loadPage(parsed.pageNumber, parsed.subpage);
    if (page == null) {
      console.log(`\n── ${key}: not in live_pages`);
      continue;
    }
    const runs = subtitleRuns(page);
    if (runs.length === 0) {
      console.log(`\n── ${key}: no text to translate`);
      continue;
    }

    const result = await translateRuns(runs);
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    const { page: english, clipped } = applySubtitles(page, runs, result.english);

    printSideBySide(key, page, english);
    // The site refuses these (see `keepsNumbers`) and shows the Portuguese.
    const lost = runs.filter((run, i) => !keepsNumbers(run.text, result.english[i]));
    console.log(`    ${runs.length} runs, ${clipped.length} clipped, ${lost.length} lost a number`);
    for (const run of lost) {
      console.log(`    lost a number, row ${run.row}: "${run.text}" → "${result.english[runs.indexOf(run)]}"`);
    }
    for (const run of clipped) {
      const full = result.english[runs.indexOf(run)];
      console.log(`    row ${run.row} col ${run.start} (max ${run.end - run.start}): "${run.text}" → "${full}"`);
    }
  }

  const cost = (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6;
  console.log(`\n${inputTokens} in / ${outputTokens} out tokens, about $${cost.toFixed(3)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
