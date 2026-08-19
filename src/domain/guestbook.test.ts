// Feature: the guestbook — a name and a third of a teletext page.
// Verifies: the snippet's fixed size and self-repair, what counts as ink, the
// bounds on a name, the reading order of the book, and that a stored entry
// nobody can read is skipped rather than rendered as an empty band.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  SNIPPET_CELLS,
  SNIPPET_ROWS,
  appendEntry,
  createEmptySnippet,
  isBlankSnippet,
  normalizeSnippet,
  readEntries,
  sortEntries,
  validateSignature,
  type GuestbookEntry,
} from './guestbook';
import { DISPLAY_NAME_MAX } from './identity';
import { COLS, ROWS, type TeletextPage } from '../types/teletext';

/** A snippet with one character on it, so it is not blank. */
function signedSnippet(char = 'A'): TeletextPage {
  const cells = createEmptySnippet();
  cells[0] = { char, fg: 'white', bg: 'black', graphics: null };
  return cells;
}

function entry(over: Partial<GuestbookEntry> = {}): GuestbookEntry {
  return {
    id: 'sig-1',
    name: 'Ana',
    authorId: 'member-1',
    cells: signedSnippet(),
    ts: 1_000,
    ...over,
  };
}

describe('the snippet', () => {
  it('is a third of a page, exactly', () => {
    // Not a number chosen for looks: the canvas renderer, the cell geometry and
    // the sixel sub-grid all work in whole rows.
    expect(SNIPPET_ROWS * 3).toBe(ROWS);
    expect(SNIPPET_CELLS).toBe(COLS * SNIPPET_ROWS);
    expect(createEmptySnippet()).toHaveLength(SNIPPET_CELLS);
  });

  it('repairs anything into exactly one snippet of valid cells', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const cells = normalizeSnippet(raw);
        expect(cells).toHaveLength(SNIPPET_CELLS);
        for (const cell of cells) {
          expect(typeof cell.char).toBe('string');
          expect(typeof cell.fg).toBe('string');
          expect(typeof cell.bg).toBe('string');
        }
      }),
    );
  });

  it('reads a short or sparse store as a whole snippet', () => {
    // What comes back from the shared document can be a sparse index map, which
    // is the shape playhtml holds a page in.
    const cells = normalizeSnippet({ 5: { char: 'X', fg: 'cyan', bg: 'black' } });
    expect(cells).toHaveLength(SNIPPET_CELLS);
    expect(cells[5].char).toBe('X');
    expect(cells[6].char).toBe(' ');
  });

  it('counts characters and blocks as ink, but not colour alone', () => {
    expect(isBlankSnippet(createEmptySnippet())).toBe(true);
    expect(isBlankSnippet(signedSnippet())).toBe(false);

    const blocks = createEmptySnippet();
    blocks[3] = { char: ' ', fg: 'red', bg: 'black', graphics: 12 };
    expect(isBlankSnippet(blocks)).toBe(false);

    // A background with nothing on it is a decision nobody can see once it is
    // eight rows in a list, so it does not make a signature.
    const coloured = createEmptySnippet();
    coloured[3] = { char: ' ', fg: 'white', bg: 'blue', graphics: null };
    expect(isBlankSnippet(coloured)).toBe(true);
  });
});

describe('validating a signature', () => {
  it('takes a name of 1..max characters, trimmed', () => {
    expect(validateSignature('  Ana  ', signedSnippet())).toEqual({
      ok: true,
      name: 'Ana',
    });
    expect(validateSignature('   ', signedSnippet())).toEqual({
      ok: false,
      reason: 'no-name',
    });
    expect(validateSignature('x'.repeat(DISPLAY_NAME_MAX + 1), signedSnippet())).toEqual({
      ok: false,
      reason: 'name-too-long',
    });
  });

  it('refuses a blank page even from someone who gave a name', () => {
    expect(validateSignature('Ana', createEmptySnippet())).toEqual({
      ok: false,
      reason: 'blank',
    });
  });

  it('reports the name first when neither is given', () => {
    // It is the field they are looking at.
    expect(validateSignature('', createEmptySnippet())).toEqual({
      ok: false,
      reason: 'no-name',
    });
  });
});

describe('the book', () => {
  it('reads newest first', () => {
    const older = entry({ id: 'a', ts: 1 });
    const newer = entry({ id: 'b', ts: 2 });
    expect(sortEntries([older, newer]).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('orders two signatures from the same millisecond the same way every time', () => {
    // Without a tiebreak the order would depend on how the CRDT happened to
    // merge, and two entries could swap places between renders.
    const a = entry({ id: 'a', ts: 5 });
    const b = entry({ id: 'b', ts: 5 });
    expect(sortEntries([b, a]).map((e) => e.id)).toEqual(['a', 'b']);
    expect(sortEntries([a, b]).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('appends a valid signature and leaves the book alone otherwise', () => {
    const book = [entry({ id: 'a', ts: 1 })];
    expect(appendEntry(book, entry({ id: 'b', ts: 2 }))).toHaveLength(2);

    const blank = entry({ id: 'c', ts: 3, cells: createEmptySnippet() });
    expect(appendEntry(book, blank).map((e) => e.id)).toEqual(['a']);

    // The input is never mutated.
    expect(book).toHaveLength(1);
  });

  it('skips a stored entry nobody could read', () => {
    const readable = entry({ id: 'a' });
    const stored = [
      readable,
      null,
      'not an entry',
      { id: 'b', name: '', cells: signedSnippet() },
      { id: 'c', name: 'Blank', cells: createEmptySnippet() },
      { name: 'No id', cells: signedSnippet() },
    ];

    expect(readEntries(stored).map((e) => e.id)).toEqual(['a']);
    expect(readEntries('nonsense')).toEqual([]);
    expect(readEntries(undefined)).toEqual([]);
  });

  it('gives every read entry a full snippet, whatever was stored', () => {
    const [read] = readEntries([{ ...entry(), cells: { 0: { char: 'A', fg: 'white', bg: 'black' } } }]);
    expect(read.cells).toHaveLength(SNIPPET_CELLS);
    expect(read.cells[0].char).toBe('A');
  });
});
