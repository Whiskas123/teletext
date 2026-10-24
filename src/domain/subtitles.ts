/**
 * SUB: an English layer over a Portuguese page.
 *
 * Teletext's own subtitles (page 888) were text drawn over the picture. This is
 * text drawn over the page: the same cells, colours and block graphics, with
 * the Portuguese words swapped for English ones. Nothing moves, so the layout
 * a page's author made survives the translation.
 *
 * ## Runs
 *
 * A row is not one string. Teletext lays things out by padding and by colour,
 * so `FUTEBOL` in yellow and `1-0` in white thirty cells to its right are two
 * pieces of text, and translating them as one would pour words across the gap.
 * A row is cut into **runs**: cells that hold text, share a style, and are not
 * separated by three or more blanks. Two is still one phrase: justified prose
 * pads its word spaces to two, and cutting there leaves holes mid-sentence. Each run is translated on its own and
 * written back into exactly its own cells, so its length is a hard budget.
 *
 * - **Block graphics end a run** and are never touched.
 * - **A cell covered by double height above it** is not drawn, so it holds no
 *   text worth translating.
 * - **The header row is chrome** (page number, channel, clock), not content.
 * - **A run with no letters** — a score, a time, a page number — is left as is.
 *
 * Known ceiling: the budget is the run's own width, even when the blanks to its
 * right could take a longer English phrase. Portuguese is usually the longer of
 * the two, so this rarely bites; widening into trailing blanks of the same
 * background is the upgrade.
 */

import { COLS, ROWS, type Cell, type TeletextPage } from '../types/teletext';

/** A piece of a row that is translated as one. */
export interface SubtitleRun {
  row: number;
  /** First column, inclusive. */
  start: number;
  /** Last column, exclusive. `end - start` is the most characters it can hold. */
  end: number;
  text: string;
}

/** Blanks in a row of the same style that still read as one phrase. */
const MAX_INNER_GAP = 2;

const LETTER = /\p{L}/u;

function charOf(cell: Cell | undefined): string {
  if (cell == null || cell.graphics != null) return '';
  return cell.char === '' ? ' ' : cell.char;
}

function sameStyle(a: Cell, b: Cell): boolean {
  return a.fg === b.fg && a.bg === b.bg && Boolean(a.doubleHeight) === Boolean(b.doubleHeight);
}

/** Every run on a page worth translating, top to bottom, left to right. */
export function subtitleRuns(page: TeletextPage): SubtitleRun[] {
  const runs: SubtitleRun[] = [];

  for (let row = 1; row < ROWS; row += 1) {
    let start = -1;
    let end = -1;

    const close = () => {
      if (start < 0) return;
      const text = page
        .slice(row * COLS + start, row * COLS + end)
        .map(charOf)
        .join('');
      if (LETTER.test(text)) runs.push({ row, start, end, text });
      start = -1;
    };

    for (let col = 0; col < COLS; col += 1) {
      const cell = page[row * COLS + col];
      const above = page[(row - 1) * COLS + col];
      const covered = row > 1 && above?.doubleHeight === true;
      const char = covered ? '' : charOf(cell);

      if (char === '' || char === ' ') {
        // A blank or a graphics cell. Blanks may sit inside a phrase; anything
        // else, or a gap that has grown too wide, ends the run.
        if (char === '' || col - end >= MAX_INNER_GAP) close();
        continue;
      }
      if (start >= 0 && !sameStyle(page[row * COLS + start], cell)) close();
      if (start < 0) start = col;
      end = col + 1;
    }
    close();
  }

  return runs;
}

/**
 * The page with each run's text replaced, cell for cell.
 *
 * Text shorter than its run is padded with blanks; longer text is cut, and the
 * runs that were cut are returned so a caller can say so rather than show a
 * clipped word as if it were right.
 *
 * Every cell takes the style of the run's first character. A blank's own
 * colours mean nothing — imported captures often give a space the background
 * colour as its foreground — so an English letter landing where the Portuguese
 * had a space would otherwise be drawn invisibly.
 */
export function applySubtitles(
  page: TeletextPage,
  runs: readonly SubtitleRun[],
  english: readonly string[],
): { page: TeletextPage; clipped: SubtitleRun[] } {
  const out = page.map((cell) => ({ ...cell }));
  const clipped: SubtitleRun[] = [];

  runs.forEach((run, i) => {
    const width = run.end - run.start;
    const text = (english[i] ?? run.text).trim();
    if (text.length > width) clipped.push(run);
    const fitted = text.slice(0, width).padEnd(width, ' ');
    const { fg, bg, doubleHeight } = page[run.row * COLS + run.start];
    for (let k = 0; k < width; k += 1) {
      Object.assign(out[run.row * COLS + run.start + k], { char: fitted[k], fg, bg, doubleHeight });
    }
  });

  return { page: out, clipped };
}

/** One translated run as it is stored: where it was, what it said, what it says now. */
export interface SubtitleEntry {
  row: number;
  col: number;
  pt: string;
  en: string;
}

/**
 * Whether `en` still carries every number `pt` had.
 *
 * Prices, scores, times and dates are what a reader comes to a page for, and
 * the one thing a translation must never lose. Each run of digits in the
 * Portuguese has to appear in the English — `5 mil` may become `5,000`, but
 * `5 000$` may not vanish. Ordinals (`3ª idade`, `1º lugar`) are words, not
 * quantities, and are left out: `3ª idade` is rightly `senior`. A translation
 * that fails this is not used, and the run stays Portuguese: a mixed page is
 * better than a wrong price.
 */
export function keepsNumbers(pt: string, en: string): boolean {
  return (pt.match(/\d+(?![\dªº])/g) ?? []).every((digits) => en.includes(digits));
}

/** The runs on a page that a stored translation still covers, with their English. */
function matchEntries(
  page: TeletextPage,
  entries: readonly SubtitleEntry[],
): { all: SubtitleRun[]; runs: SubtitleRun[]; english: string[] } {
  const byPlace = new Map(entries.map((e) => [`${e.row}:${e.col}:${e.pt}`, e.en]));
  const all = subtitleRuns(page);
  const runs: SubtitleRun[] = [];
  const english: string[] = [];
  for (const run of all) {
    const en = byPlace.get(`${run.row}:${run.start}:${run.text}`);
    if (en == null || !keepsNumbers(run.text, en)) continue;
    runs.push(run);
    english.push(en);
  }
  return { all, runs, english };
}

/**
 * The page in English, from a stored translation — or `null` if none of it
 * still applies.
 *
 * Each entry carries the Portuguese it was made from, and is used only while
 * the run at that position still reads exactly that. A page edited after it was
 * translated keeps whatever English still matches and shows the rest as it now
 * is, rather than putting an old sentence over new text. An entry that lost a
 * number is skipped the same way; see {@link keepsNumbers}.
 */
export function translatePage(
  page: TeletextPage,
  entries: readonly SubtitleEntry[],
): TeletextPage | null {
  const { runs, english } = matchEntries(page, entries);
  return runs.length === 0 ? null : applySubtitles(page, runs, english).page;
}

/**
 * How much of a page a stored translation still covers: `matched` of the
 * `total` runs worth translating. Equal means fully translated; less means the
 * page changed since (or a run was refused), and translating again catches up.
 */
export function translationCoverage(
  page: TeletextPage,
  entries: readonly SubtitleEntry[],
): { matched: number; total: number } {
  const { all, runs } = matchEntries(page, entries);
  return { matched: runs.length, total: all.length };
}

/** A page's runs and their English, as they are stored. */
export function toEntries(runs: readonly SubtitleRun[], english: readonly string[]): SubtitleEntry[] {
  return runs.map((run, i) => ({ row: run.row, col: run.start, pt: run.text, en: english[i] }));
}
