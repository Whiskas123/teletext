// Feature: which store a page's content lives in. Verifies: curated pages
// (100..699) and their carousel screens go to the database, everything else to
// playhtml, and a write is split into exactly the keys it changed.

import { describe, expect, it } from 'vitest';

import { isArchiveKey, pickStore, splitChanges } from './contentStores';

describe('content stores', () => {
  it('splits keys by page, carousel screens included', () => {
    expect(['100', '699', '220.3', 220].map(isArchiveKey)).toEqual([true, true, true, true]);
    expect(['700', '999', '726.2', 'junk'].map(isArchiveKey)).toEqual([false, false, false, false]);
    expect(pickStore({ 100: 'a', 700: 'b' }, true)).toEqual({ 100: 'a' });
  });

  it('sends only what a write changed, each half to its store', () => {
    const kept = { a: 1 };
    const before = { 100: kept, 101: { b: 1 }, 700: { c: 1 } };
    const moved = { c: 1 };
    // 700 is promoted into the archive at 102; 101 is vacated; 100 untouched.
    const after = { 100: kept, 101: {}, 102: moved, 700: {} };

    const { archive, live } = splitChanges<object>(before, after);
    expect(archive).toEqual({ 101: {}, 102: moved });
    expect(live).toEqual({ 700: {} });
  });
});
