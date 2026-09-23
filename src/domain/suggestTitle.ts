/**
 * A title for a page, read off the page itself.
 *
 * About 1,250 captures — all of SIC — arrive with no title in the manifest,
 * and a page without one is a blank line in the Yellow Pages and invisible to
 * search by name. Typing twelve hundred titles is the slowest part of filling
 * the service, and most pages already say what they are in their first lines:
 * a section banner, then a headline.
 *
 * So this reads the top of the page and skips what is not a title — the
 * broadcaster's header with its page number and clock, rows of graphics,
 * dates, prices — and returns the first line of words, prefixed with a short
 * banner above it when there is one (`DESPORTO — Benfica vence em Braga`).
 * It is a suggestion: the operator sees it and can change it.
 *
 * Pure and framework-free.
 */

import { pageRows } from './pageSearch';
import { MAX_TITLE_LENGTH } from './titles';

/** How far down the page a title is looked for. Past this it is body text. */
const SEARCH_ROWS = 10;

/** A banner shorter than this is joined to the line under it. */
const SHORT_BANNER = 14;

/** `I N T E R N A C I O N A L` → `INTERNACIONAL`. */
function unspace(line: string): string {
  return /^(\S )+\S$/.test(line) && line.length >= 7 ? line.replace(/ /g, '') : line;
}

/** Whether a row reads as words rather than as a header, a date or a table. */
function isWordy(line: string): boolean {
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  if (letters < 4) return false;
  // Mostly letters, not a row of prices, scores or phone numbers.
  if (letters / line.replace(/\s/g, '').length < 0.6) return false;
  // The broadcaster's header: a clock, or a page number up front.
  if (/\b\d{1,2}[:.]\d{2}(?::\d{2})?\b/.test(line) && /\b[1-8]\d{2}\b/.test(line)) return false;
  if (/^(?:P\s?)?[1-8]\d{2}(?:\/\d+)?\b/.test(line)) return false;
  return true;
}

function tidy(line: string): string {
  return line
    .replace(/[.:\-–—*=_|>]+$/u, '')
    .replace(/^[.:\-–—*=_|>]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The suggested title, or `''` when the page has no line that reads as one. */
export function suggestTitle(page: unknown): string {
  const lines = pageRows(page)
    .slice(0, SEARCH_ROWS)
    .map((row) => tidy(unspace(row)))
    .filter(isWordy);

  if (lines.length === 0) return '';
  const [first, second] = lines;
  const title =
    first.length < SHORT_BANNER && second != null && first === first.toUpperCase()
      ? `${first} — ${second}`
      : first;
  return title.length <= MAX_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_TITLE_LENGTH - 1).replace(/\s+\S*$/, '')}…`;
}
