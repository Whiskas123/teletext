/**
 * Tests for the unconfirmed-edit overlay.
 *
 * The overlay exists so an edit reaches the screen without waiting for the
 * shared store, so the properties that matter are about *handing back* control:
 * a local edit must win while it is outstanding, and must stop winning the
 * moment the store agrees with it — otherwise the cell it covers would be
 * frozen against everybody else's edits for as long as the editor is open.
 */

import { describe, expect, it } from 'vitest';

import { unsettledEdits, withLocalEdits, type LocalEdits } from './localEdits';
import { createEmptyPage, type Cell, type TeletextPage } from '../types/teletext';

function cell(char: string, overrides: Partial<Cell> = {}): Cell {
  return { char, fg: 'white', bg: 'black', graphics: null, ...overrides };
}

/** A page with `char` written at `index`. */
function pageWith(index: number, value: Cell): TeletextPage {
  const page = createEmptyPage();
  page[index] = value;
  return page;
}

describe('withLocalEdits', () => {
  it('lays local cells over the stored page', () => {
    const stored = createEmptyPage();
    const page = withLocalEdits(stored, new Map([[42, cell('A')]]));

    expect(page[42].char).toBe('A');
    // Everything else is the stored page, untouched.
    expect(page[41]).toBe(stored[41]);
  });

  it('returns the stored page itself when there is nothing local', () => {
    // A page being watched rather than edited must cost nothing at all — not
    // even a copy of the array.
    const stored = createEmptyPage();
    expect(withLocalEdits(stored, new Map())).toBe(stored);
  });

  it('does not modify the stored page', () => {
    const stored = createEmptyPage();
    withLocalEdits(stored, new Map([[7, cell('Z')]]));
    expect(stored[7].char).toBe(' ');
  });

  it('ignores an index off the page', () => {
    const stored = createEmptyPage();
    const page = withLocalEdits(stored, new Map([[99999, cell('X')]]));
    expect(page).toHaveLength(stored.length);
  });
});

describe('unsettledEdits', () => {
  it('keeps an edit the store has not caught up with', () => {
    const local = new Map([[42, cell('A')]]);
    expect(unsettledEdits(createEmptyPage(), local)).toBe(local);
  });

  it('drops an edit the store now agrees with', () => {
    // Compared by value: the cell has been through Yjs and back, so it is a
    // different object carrying the same thing.
    const stored = pageWith(42, cell('A'));
    const settled = unsettledEdits(stored, new Map([[42, cell('A')]]));

    expect(settled.size).toBe(0);
  });

  it('keeps the outstanding edits when only some have settled', () => {
    const stored = pageWith(42, cell('A'));
    const settled = unsettledEdits(
      stored,
      new Map([
        [42, cell('A')],
        [43, cell('B')],
      ]),
    );

    expect([...settled.keys()]).toEqual([43]);
  });

  it('keeps an edit the store disagrees with', () => {
    // Somebody else wrote a different character to the same cell. The local
    // edit is the newer one and stays on screen until it is written and echoed.
    const stored = pageWith(42, cell('B'));
    const settled = unsettledEdits(stored, new Map([[42, cell('A')]]));

    expect(settled.get(42)?.char).toBe('A');
  });

  it('compares every field that renders, not just the character', () => {
    const stored = pageWith(42, cell('A', { fg: 'red' }));
    const settled = unsettledEdits(stored, new Map([[42, cell('A', { fg: 'cyan' })]]));

    expect(settled.get(42)?.fg).toBe('cyan');
  });

  it('is idempotent, so a repeated pass drops nothing extra', () => {
    // The pruning happens during render, and a render can be discarded and run
    // again; running it twice has to mean the same as running it once.
    const stored = pageWith(42, cell('A'));
    const local = new Map([
      [42, cell('A')],
      [43, cell('B')],
    ]);

    const once = unsettledEdits(stored, local);
    expect(unsettledEdits(stored, once)).toEqual(once);
  });

  it('leaves an empty overlay alone', () => {
    const empty: LocalEdits = new Map();
    expect(unsettledEdits(createEmptyPage(), empty)).toBe(empty);
  });
});

describe('an edit through its whole life', () => {
  it('shows immediately, survives an unrelated update, and hands back on echo', () => {
    let stored = createEmptyPage();
    let local: LocalEdits = new Map([[42, cell('A')]]);

    // Typed: on screen before the store has heard of it.
    expect(withLocalEdits(stored, local)[42].char).toBe('A');

    // Somebody else edits a different cell. The store's version of cell 42 is
    // still blank, so the local edit must still be showing.
    stored = pageWith(100, cell('X'));
    local = unsettledEdits(stored, local);
    expect(withLocalEdits(stored, local)[42].char).toBe('A');
    expect(withLocalEdits(stored, local)[100].char).toBe('X');

    // The write lands and comes back. The overlay lets go.
    stored = pageWith(42, cell('A'));
    local = unsettledEdits(stored, local);
    expect(local.size).toBe(0);
    expect(withLocalEdits(stored, local)).toBe(stored);

    // And now that it has let go, somebody else can change that cell.
    stored = pageWith(42, cell('Q'));
    expect(withLocalEdits(stored, unsettledEdits(stored, local))[42].char).toBe('Q');
  });
});
