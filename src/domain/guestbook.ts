/**
 * The guestbook: what a signature is, and what makes one valid.
 *
 * A visitor signs by leaving a name and a small teletext page — a *snippet*, a
 * third of a page tall. Everything about what that means lives here, pure and
 * framework-free, so the rules can be tested without a live Yjs connection; the
 * playhtml binding in `collab/useGuestbook.ts` only writes what this approves.
 *
 * ## Why a third of a page
 *
 * A full 40x24 page is what the editor is for, and a guestbook of them would be
 * a list nobody scrolls to the bottom of. Eight rows is a third exactly, which
 * matters more than it sounds: the cell geometry, the sixel sub-grid and the
 * canvas renderer all work in whole rows, so a third divides without leaving a
 * remainder anywhere. It is also about as much as a teletext page ever gave one
 * item — a headline and a few lines under it — so the constraint is period as
 * well as practical.
 *
 * ## Why entries are whole values
 *
 * A page in the archive is stored cell by cell so two people editing it merge.
 * A signature is not edited: it is written once, by one person, and then it is
 * someone else's. So an entry is a plain object appended to a list, and the
 * whole merge problem does not arise.
 */

import { COLS, type Cell, type TeletextPage } from '../types/teletext';
import { normalizeCell } from './pageOps';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from './identity';

/** How many rows a snippet has: a third of a page's 24. */
export const SNIPPET_ROWS = 8;

/** Cells in a snippet — the same 40 columns, eight rows deep. */
export const SNIPPET_CELLS = COLS * SNIPPET_ROWS;

/** One signature in the book. */
export interface GuestbookEntry {
  id: string;
  /** Who signed, as they gave it. */
  name: string;
  /** The stable session id of the signer, so a client can recognise its own. */
  authorId: string;
  /** The snippet: exactly {@link SNIPPET_CELLS} cells. */
  cells: TeletextPage;
  /** When it was signed, epoch milliseconds. */
  ts: number;
}

/** The empty cell, matching `types/teletext.ts` and `domain/pageOps.ts`. */
function emptyCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

/** A blank snippet, which is what the signing form opens on. */
export function createEmptySnippet(): TeletextPage {
  return Array.from({ length: SNIPPET_CELLS }, emptyCell);
}

/**
 * Repair anything into exactly {@link SNIPPET_CELLS} valid cells.
 *
 * The same contract `normalizePage` has for a full page, at snippet size, and
 * for the same reason: what comes back out of the shared document was written
 * by a client, so it is repaired rather than trusted. Accepts a positional
 * array or an index-keyed map, since both are shapes the document can hold.
 */
export function normalizeSnippet(raw: unknown): TeletextPage {
  const source =
    raw !== null && typeof raw === 'object'
      ? (raw as Record<PropertyKey, unknown>)
      : undefined;
  const cells: TeletextPage = new Array<Cell>(SNIPPET_CELLS);
  for (let i = 0; i < SNIPPET_CELLS; i += 1) {
    cells[i] = normalizeCell(source ? source[i] : undefined);
  }
  return cells;
}

/**
 * Whether a snippet has anything on it.
 *
 * "Anything" is a typed character or a block, not a colour: setting a cell's
 * background to blue and leaving it blank is a decision nobody can see once it
 * is one of eight rows in a list, and an entry that renders as an empty band
 * reads as a bug. The front page's showcase refuses a page on the same test —
 * claimed by a title but holding no ink.
 */
export function isBlankSnippet(cells: TeletextPage): boolean {
  return !cells.some(
    (cell) => (cell.char !== ' ' && cell.char !== '') || cell.graphics != null,
  );
}

/** Why a signature was refused, or that it was accepted. */
export type SignatureValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'no-name' | 'name-too-long' | 'blank' };

/**
 * Validate a candidate signature.
 *
 * The name is bounded exactly as a member's display name is
 * ({@link DISPLAY_NAME_MIN}..{@link DISPLAY_NAME_MAX}), because it is the same
 * kind of thing said in a different place, and a name that is legal in the room
 * sidebar and illegal here would be a puzzle rather than a rule.
 *
 * A blank snippet is refused last, so someone who typed neither gets told about
 * the name first — it is the field they are looking at.
 */
export function validateSignature(
  rawName: string,
  cells: TeletextPage,
): SignatureValidation {
  const name = rawName.trim();
  if (name.length < DISPLAY_NAME_MIN) return { ok: false, reason: 'no-name' };
  if (name.length > DISPLAY_NAME_MAX) return { ok: false, reason: 'name-too-long' };
  if (isBlankSnippet(cells)) return { ok: false, reason: 'blank' };
  return { ok: true, name };
}

/**
 * Order a book for reading: newest first.
 *
 * A paper guestbook reads the other way, oldest at the front, because you sign
 * at the end of it. On a screen the reason for that is gone and the cost is
 * real — someone who has just signed would have to scroll past everyone who
 * came before to see their own page. Ties break on id so the order is total and
 * two entries sharing a millisecond do not swap places between renders.
 */
export function sortEntries(entries: readonly GuestbookEntry[]): GuestbookEntry[] {
  return [...entries].sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

/**
 * Append one validated signature, returning a new list in reading order.
 *
 * The input is never mutated, and an invalid signature is a no-op — the book is
 * returned as it was, so a caller can treat a refusal as "nothing happened".
 */
export function appendEntry(
  entries: readonly GuestbookEntry[],
  entry: GuestbookEntry,
): GuestbookEntry[] {
  const validation = validateSignature(entry.name, entry.cells);
  if (!validation.ok) return sortEntries(entries);
  return sortEntries([...entries, { ...entry, name: validation.name }]);
}

/**
 * Repair a stored entry, or reject it.
 *
 * Returns `null` for anything that is not recognisably a signature, so a
 * malformed record written by a future version — or by anyone poking at the
 * shared document — is skipped rather than rendered as a nameless empty band.
 */
export function normalizeEntry(raw: unknown): GuestbookEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Partial<GuestbookEntry>;
  if (typeof source.id !== 'string' || source.id.length === 0) return null;
  if (typeof source.name !== 'string') return null;

  const name = source.name.trim();
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) return null;

  const cells = normalizeSnippet(source.cells);
  if (isBlankSnippet(cells)) return null;

  return {
    id: source.id,
    name,
    authorId: typeof source.authorId === 'string' ? source.authorId : '',
    cells,
    ts: Number.isFinite(source.ts) ? (source.ts as number) : 0,
  };
}

/** Every readable signature in the stored list, in reading order. */
export function readEntries(raw: unknown): GuestbookEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: GuestbookEntry[] = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry != null) entries.push(entry);
  }
  return sortEntries(entries);
}
