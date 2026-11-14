import { describe, expect, it } from 'vitest';

import { staleScreens } from './staleWrites';

const none = () => false;

describe('staleScreens', () => {
  it('lets a save through when every screen is as the tab last saw it', () => {
    const stored = [{ pageNumber: 123, subpage: 1, digest: 'a' }];
    expect(staleScreens(new Map([['123.1', 'a']]), new Map([['123.1', 'b']]), none, stored)).toEqual([]);
  });

  it('refuses a tab writing over a page another tab moved onto that number (2026-11-14)', () => {
    // The tab still believed 123 held Utilidades ("u"); another tab had put Acontece ("acontece") there.
    const stored = [{ pageNumber: 123, subpage: 1, digest: 'acontece' }];
    expect(staleScreens(new Map([['123.1', 'u']]), new Map([['123.1', 'u2']]), none, stored)).toEqual(['123.1']);
  });

  it('refuses writing a screen the tab thought was free, now taken', () => {
    const stored = [{ pageNumber: 300, subpage: 1, digest: 'someone' }];
    expect(staleScreens(new Map([['300.1', null]]), new Map([['300.1', 'mine']]), none, stored)).toEqual(['300.1']);
  });

  it('accepts a retried save whose screen already landed', () => {
    const stored = [{ pageNumber: 123, subpage: 1, digest: 'new' }];
    expect(staleScreens(new Map([['123.1', 'old']]), new Map([['123.1', 'new']]), none, stored)).toEqual([]);
  });

  it('refuses re-creating a screen someone deleted, but not deleting one already gone', () => {
    expect(staleScreens(new Map([['200.1', 'x']]), new Map([['200.1', 'y']]), none, [])).toEqual(['200.1']);
    const deleting = (page: number) => page === 200;
    expect(staleScreens(new Map([['200.1', 'x']]), new Map(), deleting, [])).toEqual([]);
  });

  it('refuses a deletion that would take a screen the tab never knew of', () => {
    const deleting = (page: number, screen: number) => page === 150 && screen > 1;
    const stored = [
      { pageNumber: 150, subpage: 1, digest: 'a' },
      { pageNumber: 150, subpage: 2, digest: 'b' },
      { pageNumber: 150, subpage: 3, digest: 'added elsewhere' },
    ];
    expect(staleScreens(new Map([['150.2', 'b']]), new Map(), deleting, stored)).toEqual(['150.3']);
  });
});
