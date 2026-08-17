/**
 * Edits that have happened but that the store has not confirmed yet.
 *
 * A cell edit used to reach the screen only by going through the shared store
 * and coming back: type a character, write it into the Yjs document, wait for
 * the document to report the change, rebuild the page from it, render. That
 * round trip is not free, and it is not free in a way that grows with the
 * workshop — the store hands its subscribers a `structuredClone` of the
 * *entire* `pages` channel on every update, so the cost of typing one character
 * is proportional to how many pages everybody else has ever drawn. On a
 * workshop with a corpus loaded that is tens of milliseconds a keystroke, and a
 * brush stroke samples the pointer a hundred times a second.
 *
 * So the screen no longer waits for it. An edit is applied here immediately and
 * laid over whatever the store last said, and the store is written to on its own
 * schedule (see `collab/useEditPage.ts`). What is on screen is therefore always
 * at least as new as what is stored, never behind it.
 *
 * An entry lives until the store catches up with it, and no longer:
 * {@link unsettledEdits} drops the ones the store now agrees with. That is what
 * keeps the overlay from becoming a second, permanent copy of the page — if a
 * local edit outlived its confirmation it would go on masking that cell forever,
 * and another member's later edit to it would never be seen.
 *
 * Pure and framework-free.
 */

import type { Cell, TeletextPage } from '../types/teletext';
import { sameCell } from './pageReuse';

/**
 * Cells edited locally, by cell index.
 *
 * Owned by one editor and mutated in place as it edits — clearing a page is 960
 * calls in a loop, and copying the map on each of them would make that
 * quadratic. Mutation only ever happens in an event handler, never during a
 * render, so a render that reads it always sees one whole consistent state.
 */
export type LocalEdits = Map<number, Cell>;

/**
 * The local edits the store has *not* caught up on.
 *
 * An edit is settled once the stored page renders identically to it — by value,
 * not by identity, since the value has been through the store and back and is a
 * different object on the way out. Settled edits are dropped: the store is the
 * authority again for those cells, which is what lets a later edit by somebody
 * else show up.
 *
 * Returns the map it was given when every entry is still outstanding, which is
 * the common case during a stroke and allocates nothing.
 */
export function unsettledEdits(stored: TeletextPage, local: LocalEdits): LocalEdits {
  if (local.size === 0) return local;

  let settled = 0;
  for (const [index, cell] of local) {
    const storedCell = stored[index];
    if (storedCell !== undefined && sameCell(storedCell, cell)) settled += 1;
  }
  if (settled === 0) return local;

  const next: LocalEdits = new Map();
  if (settled === local.size) return next;
  for (const [index, cell] of local) {
    const storedCell = stored[index];
    if (storedCell === undefined || !sameCell(storedCell, cell)) next.set(index, cell);
  }
  return next;
}

/**
 * `stored`, with the local edits laid over it.
 *
 * Returns `stored` itself when there are none, so a page nobody is editing —
 * every page being watched rather than drawn on — costs nothing at all.
 */
export function withLocalEdits(
  stored: TeletextPage,
  local: ReadonlyMap<number, Cell>,
): TeletextPage {
  if (local.size === 0) return stored;
  const page = stored.slice();
  for (const [index, cell] of local) {
    if (index >= 0 && index < page.length) page[index] = cell;
  }
  return page;
}
