/**
 * The fastext index line: the four coloured destinations every page carries.
 *
 * On a real service these were the four coloured words along the bottom of the
 * picture *and* the four coloured keys on the set, and they were the same four
 * destinations — a red key that went somewhere other than the red word would
 * have been a fault. Here, likewise: {@link TeletextGrid} draws the line and
 * {@link CrtTelevision} labels its keys from this one list, so the two cannot
 * drift apart.
 *
 * It lives in `domain/` rather than in either of them for that reason — neither
 * owns it, and importing a component to reach a constant drags a whole render
 * tree into places that only wanted four page numbers.
 */

/** A teletext row is 40 columns, split into four equal zones. */
export const COLS_PER_INDEX = 10;

export interface IndexLineItem {
  /** The word as it appears on the picture, and on the key's label. */
  label: string;
  /** Its teletext colour, which is also the colour of the key. */
  fg: 'red' | 'green' | 'yellow' | 'cyan';
  /** Where it goes. */
  page: number;
}

export const INDEX_LINE: IndexLineItem[] = [
  { label: 'INDEX', fg: 'red', page: 100 },
  { label: 'TV GUIDE', fg: 'green', page: 200 },
  { label: 'WORLD', fg: 'yellow', page: 300 },
  { label: 'FINANCE', fg: 'cyan', page: 400 },
];

export interface IndexLineRange {
  /** First column of the word, inclusive. */
  start: number;
  /** One past its last column. */
  end: number;
  item: IndexLineItem;
}

/** Each word centred in its own ten-column zone, so the four are evenly spread. */
export const INDEX_LINE_RANGES: IndexLineRange[] = INDEX_LINE.map((item, i) => {
  const zoneStart = i * COLS_PER_INDEX;
  const start = zoneStart + Math.floor((COLS_PER_INDEX - item.label.length) / 2);
  return { start, end: start + item.label.length, item };
});
