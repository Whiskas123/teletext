/**
 * Searching the pages by their text.
 *
 * The Yellow Pages directory answers "what is on this service?"; this answers
 * "which page said that?" — which is the question you actually have when
 * looking for a football result or a phone number in a few hundred pages.
 *
 * ## Reading text back out of a grid
 *
 * A page is 960 cells, not a string. Recovering words means reading each row
 * left to right and taking each cell's character, with two wrinkles that decide
 * whether a search is any use:
 *
 * - **Block graphics carry no text.** A mosaic cell has a `graphics` pattern
 *   and its `char` is meaningless; treating it as a character would splice
 *   noise into the middle of words and stop them matching.
 * - **Runs of spaces are one gap.** Teletext lays things out by padding, so
 *   `NEWS` and `201` on the same row can be thirty spaces apart. Collapsing
 *   runs of blanks makes a row read as words rather than as one long line, and
 *   lets a snippet show something legible.
 *
 * ## Matching
 *
 * Case- and accent-insensitive, because the archive is Portuguese and nobody
 * looking for `eleicoes` should have to type `eleições`. Comparison is done on
 * a normalised copy while offsets stay valid for the original text, so the
 * snippet shows what the page really says.
 */

import { COLS, ROWS, type TeletextPage } from '../types/teletext';
import { normalizePage } from './pageOps';

/** How much context to show around a hit. */
const SNIPPET_RADIUS = 28;

/** Shortest query worth running. One character matches nearly everything. */
export const MIN_QUERY_LENGTH = 2;

/** One page that matched, and where. */
export interface SearchHit {
  pageNumber: number;
  /**
   * Which screen of the page's carousel the match is on, from 1.
   *
   * A carousel's later screens are whole pages of text that the reader can only
   * reach with the subpage arrows, so a search that only read the first screen
   * would quietly fail to find most of a long story — which is precisely the
   * content someone is searching for.
   */
  subpage: number;
  title: string;
  /** The row the first match is on, 0-based, or `null` if only the title matched. */
  row: number | null;
  /** A short piece of the page's text around the match, for showing in a list. */
  snippet: string;
  /** Offsets of the match within {@link snippet}, for highlighting. */
  match: { start: number; end: number } | null;
  /** Whether the page's title matched, as opposed to its content. */
  inTitle: boolean;
}

/**
 * Fold case and strip accents, so `Eleições` and `eleicoes` compare equal.
 *
 * Length is preserved: NFD splits a letter from its accent, and dropping only
 * the combining marks leaves one character per original character, which is
 * what keeps match offsets usable against the untouched text.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * One row of a page as text, with graphics cells read as blanks and runs of
 * blanks collapsed to a single space.
 */
export function rowText(page: TeletextPage, row: number): string {
  let out = '';
  for (let col = 0; col < COLS; col += 1) {
    const cell = page[row * COLS + col];
    // A mosaic cell's `char` is whatever was last typed there and means
    // nothing once graphics are on; it reads as a gap.
    const char = cell == null || cell.graphics != null ? ' ' : cell.char;
    out += char === '' ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Every row of a page as text, blank rows included so row numbers line up. */
export function pageRows(page: unknown): string[] {
  const normalized = normalizePage(page);
  const rows: string[] = [];
  for (let row = 0; row < ROWS; row += 1) rows.push(rowText(normalized, row));
  return rows;
}

/** A page's whole text, one row per line. */
export function pageText(page: unknown): string {
  return pageRows(page).join('\n');
}

/** A short piece of `text` around `[start, end)`, with the offsets rebased. */
function snippetAround(
  text: string,
  start: number,
  end: number,
): { snippet: string; match: { start: number; end: number } } {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  const lead = from > 0 ? '…' : '';
  const tail = to < text.length ? '…' : '';
  return {
    snippet: `${lead}${text.slice(from, to)}${tail}`,
    match: { start: start - from + lead.length, end: end - from + lead.length },
  };
}

/** What to search: a page number, its title, and its cells. */
export interface SearchablePage {
  pageNumber: number;
  /** Screen of the page's carousel; absent means the page itself. */
  subpage?: number;
  title: string;
  page: unknown;
}

/**
 * The pages whose title or text contains `query`, in ascending page order.
 *
 * Returns nothing for a query shorter than {@link MIN_QUERY_LENGTH} rather than
 * every page: a one-character search is not a search.
 */
export function searchPages(
  pages: readonly SearchablePage[],
  query: string,
): SearchHit[] {
  const needle = foldForSearch(query.trim());
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const hits: SearchHit[] = [];

  // The listing comes from playhtml, which any client can write to, so an entry
  // that is not a page is dropped rather than trusted — the same treatment
  // `normalizePage` and `buildDirectory` give that store.
  const searchable = pages
    .filter(
      (entry): entry is SearchablePage =>
        entry != null &&
        typeof entry === 'object' &&
        Number.isInteger((entry as SearchablePage).pageNumber),
    )
    .map((entry) => ({
      pageNumber: entry.pageNumber,
      subpage: Number.isInteger(entry.subpage) ? (entry.subpage as number) : 1,
      title: typeof entry.title === 'string' ? entry.title : '',
      page: entry.page,
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber || a.subpage - b.subpage);

  for (const { pageNumber, subpage, title, page } of searchable) {
    // A title belongs to the page, not to one of its screens, so it is matched
    // once — on the first. Matching it per screen would return a three-screen
    // page three times for one hit on its name.
    const titleIndex = subpage === 1 ? foldForSearch(title).indexOf(needle) : -1;
    if (titleIndex !== -1) {
      hits.push({
        pageNumber,
        subpage,
        title,
        row: null,
        inTitle: true,
        ...snippetAround(title, titleIndex, titleIndex + needle.length),
      });
      continue;
    }

    // First hit only: a screen is a result once, and the first line it appears
    // on is the one worth showing. Screens are counted separately, so a story
    // spread over a carousel can be found by whichever part of it you remember.
    const rows = pageRows(page);
    for (const [row, text] of rows.entries()) {
      const index = foldForSearch(text).indexOf(needle);
      if (index === -1) continue;
      hits.push({
        pageNumber,
        subpage,
        title,
        row,
        inTitle: false,
        ...snippetAround(text, index, index + needle.length),
      });
      break;
    }
  }

  return hits;
}
