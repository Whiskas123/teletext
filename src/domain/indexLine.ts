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

import { COLS } from '../types/teletext';

export interface IndexLineItem {
  /** The word as it appears on the picture, and on the key's label. */
  label: string;
  /** Its teletext colour, which is also the colour of the key. */
  fg: 'red' | 'green' | 'yellow' | 'cyan';
  /** Where it goes. */
  page: number;
}

/**
 * Pages that exist here, not the broadcast's sections: the archive was
 * renumbered on import, so a classic TV GUIDE on 200 lands on whatever the dial
 * carries on to. Expo 98 is the archive's most complete self-contained service,
 * with its own index. The labels together must leave a gap between each pair
 * in a 40-column row.
 */
export const INDEX_LINE: IndexLineItem[] = [
  { label: 'TUTORIAL', fg: 'red', page: 100 },
  { label: 'INDEX', fg: 'green', page: 101 },
  { label: 'EXPO 98', fg: 'yellow', page: 102 },
  { label: 'PLAYGROUND', fg: 'cyan', page: 700 },
];

export interface IndexLineRange {
  /** First column of the word, inclusive. */
  start: number;
  /** One past its last column. */
  end: number;
  item: IndexLineItem;
}

/**
 * Laid out like flexbox's `justify-content: space-between`: the first word
 * starts at column 0 and the last ends at column 39, flush with the header row
 * above, and the free columns are shared between the gaps. Gaps can't be
 * fractional, so each gap is rounded and some come out a column wider than
 * others.
 */
const FREE_COLS = COLS - INDEX_LINE.reduce((sum, item) => sum + item.label.length, 0);

export const INDEX_LINE_RANGES: IndexLineRange[] = INDEX_LINE.map((item, i) => {
  const before = INDEX_LINE.slice(0, i).reduce((sum, prev) => sum + prev.label.length, 0);
  const start = before + Math.round((i * FREE_COLS) / (INDEX_LINE.length - 1));
  return { start, end: start + item.label.length, item };
});
