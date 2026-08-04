/**
 * Tests for reading a flat page listing as a directory tree.
 *
 * The property that matters most is that the directory lists everything it was
 * given. A page dropped from the index because a heading was not marked yet
 * would be invisible to anyone browsing, and nothing in the UI would show that
 * it had happened.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_KIND,
  PAGE_KINDS,
  buildDirectory,
  flattenDirectory,
  isPageKind,
  kindAt,
  sectionRange,
  sectionSize,
  type DirectoryEntry,
} from './directory';

const arbEntry: fc.Arbitrary<DirectoryEntry> = fc.record({
  pageNumber: fc.integer({ min: 100, max: 999 }),
  title: fc.string({ maxLength: 20 }),
  kind: fc.constantFrom(...PAGE_KINDS),
});

const arbEntries = fc
  .uniqueArray(arbEntry, { selector: (e) => e.pageNumber, maxLength: 40 });

describe('buildDirectory', () => {
  it('lists every page it was given, whatever the kinds are', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const flat = flattenDirectory(buildDirectory(entries));
        expect(flat).toHaveLength(entries.length);
        expect(new Set(flat.map((n) => n.pageNumber))).toEqual(
          new Set(entries.map((e) => e.pageNumber)),
        );
      }),
    );
  });

  it('reads in ascending page order regardless of input order', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const shuffled = [...entries].reverse();
        expect(buildDirectory(shuffled)).toEqual(buildDirectory(entries));
      }),
    );
  });

  it('never nests an ordinary page under another ordinary page', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        for (const node of flattenDirectory(buildDirectory(entries))) {
          if (node.kind === 'page') expect(node.children).toEqual([]);
        }
      }),
    );
  });

  it('files pages under the heading above them', () => {
    const tree = buildDirectory([
      { pageNumber: 200, title: 'News', kind: 'category' },
      { pageNumber: 201, title: 'Home', kind: 'page' },
      { pageNumber: 202, title: 'World', kind: 'page' },
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 301, title: 'Football', kind: 'page' },
    ]);
    expect(tree.map((n) => n.pageNumber)).toEqual([200, 300]);
    expect(tree[0].children.map((n) => n.pageNumber)).toEqual([201, 202]);
    expect(tree[1].children.map((n) => n.pageNumber)).toEqual([301]);
  });

  it('nests subcategories inside the category above them', () => {
    const tree = buildDirectory([
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 310, title: 'Football', kind: 'subcategory' },
      { pageNumber: 311, title: 'Results', kind: 'page' },
      { pageNumber: 320, title: 'Cycling', kind: 'subcategory' },
      { pageNumber: 321, title: 'Stages', kind: 'page' },
    ]);
    expect(tree).toHaveLength(1);
    const [sport] = tree;
    expect(sport.children.map((n) => n.pageNumber)).toEqual([310, 320]);
    expect(sport.children[0].children.map((n) => n.pageNumber)).toEqual([311]);
    expect(sport.children[1].children.map((n) => n.pageNumber)).toEqual([321]);
  });

  it('starts a fresh subsection at the next category', () => {
    const tree = buildDirectory([
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 310, title: 'Football', kind: 'subcategory' },
      { pageNumber: 400, title: 'Finance', kind: 'category' },
      { pageNumber: 401, title: 'Shares', kind: 'page' },
    ]);
    // 401 belongs to Finance, not to the Football subsection left open before it.
    expect(tree[1].children.map((n) => n.pageNumber)).toEqual([401]);
  });

  it('files a subsubcategory under the subcategory above it', () => {
    const [sport] = buildDirectory([
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 310, title: 'Football', kind: 'subcategory' },
      { pageNumber: 311, title: 'Primeira Liga', kind: 'subsubcategory' },
      { pageNumber: 312, title: 'Results', kind: 'page' },
      { pageNumber: 320, title: 'Cycling', kind: 'subcategory' },
    ]);

    const football = sport.children[0];
    expect(football.pageNumber).toBe(310);
    const liga = football.children[0];
    expect(liga.pageNumber).toBe(311);
    // The page after it belongs to the innermost heading still open.
    expect(liga.children.map((c) => c.pageNumber)).toEqual([312]);
    // And the next subcategory closes it rather than nesting inside it.
    expect(sport.children.map((c) => c.pageNumber)).toEqual([310, 320]);
  });

  it('promotes a subsubcategory with no heading above it at all', () => {
    const tree = buildDirectory([
      { pageNumber: 200, title: 'Orphan', kind: 'subsubcategory' },
      { pageNumber: 201, title: 'Child', kind: 'page' },
    ]);

    expect(tree.map((n) => n.pageNumber)).toEqual([200]);
    expect(tree[0].children.map((n) => n.pageNumber)).toEqual([201]);
  });

  it('lets a category close every level beneath it', () => {
    const tree = buildDirectory([
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 310, title: 'Football', kind: 'subcategory' },
      { pageNumber: 311, title: 'Primeira Liga', kind: 'subsubcategory' },
      { pageNumber: 400, title: 'Finance', kind: 'category' },
      { pageNumber: 401, title: 'Shares', kind: 'page' },
    ]);

    expect(tree.map((n) => n.pageNumber)).toEqual([300, 400]);
    // 401 must land under Finance, not under the subsubcategory left open.
    expect(tree[1].children.map((n) => n.pageNumber)).toEqual([401]);
  });

  it('promotes a subcategory that has no category above it', () => {
    const tree = buildDirectory([
      { pageNumber: 200, title: 'Orphan', kind: 'subcategory' },
      { pageNumber: 201, title: 'Child', kind: 'page' },
    ]);
    expect(tree.map((n) => n.pageNumber)).toEqual([200]);
    expect(tree[0].children.map((n) => n.pageNumber)).toEqual([201]);
  });

  it('keeps pages that come before any heading at the top level', () => {
    const tree = buildDirectory([
      { pageNumber: 100, title: 'Index', kind: 'page' },
      { pageNumber: 200, title: 'News', kind: 'category' },
    ]);
    expect(tree.map((n) => n.pageNumber)).toEqual([100, 200]);
  });

  it('treats a missing or unknown kind as an ordinary page', () => {
    const tree = buildDirectory([
      { pageNumber: 200, title: 'News', kind: 'category' },
      { pageNumber: 201, title: 'No kind' },
      { pageNumber: 202, title: 'Bad kind', kind: 'nonsense' as never },
    ]);
    expect(tree[0].children.map((n) => n.pageNumber)).toEqual([201, 202]);
  });

  it('handles an empty listing', () => {
    expect(buildDirectory([])).toEqual([]);
  });

  it('never throws, and silently drops anything that is not a page', () => {
    // The listing comes from playhtml, which any client can write to.
    fc.assert(
      fc.property(fc.array(fc.anything()), (input) => {
        expect(() => buildDirectory(input as DirectoryEntry[])).not.toThrow();
      }),
    );
    expect(buildDirectory([null, undefined, 7, 'x'] as never)).toEqual([]);
    expect(
      buildDirectory([{ pageNumber: 1.5 }, { pageNumber: 200, title: 'ok' }] as never),
    ).toHaveLength(1);
  });
});

describe('kindAt', () => {
  it('defaults to an ordinary page', () => {
    expect(kindAt(undefined, 100)).toBe(DEFAULT_PAGE_KIND);
    expect(kindAt({}, 100)).toBe(DEFAULT_PAGE_KIND);
    expect(kindAt({ 100: 'nonsense' as never }, 100)).toBe(DEFAULT_PAGE_KIND);
  });

  it('returns a stored kind', () => {
    expect(kindAt({ 200: 'category' }, 200)).toBe('category');
  });
});

describe('isPageKind', () => {
  it('accepts only the three kinds', () => {
    for (const kind of PAGE_KINDS) expect(isPageKind(kind)).toBe(true);
    for (const bad of ['', 'Category', null, 0, {}]) expect(isPageKind(bad)).toBe(false);
  });
});

describe('sectionSize and sectionRange', () => {
  it('counts a heading and everything beneath it', () => {
    const [sport] = buildDirectory([
      { pageNumber: 300, title: 'Sport', kind: 'category' },
      { pageNumber: 310, title: 'Football', kind: 'subcategory' },
      { pageNumber: 311, title: 'Results', kind: 'page' },
    ]);
    expect(sectionSize(sport)).toBe(3);
    expect(sectionRange(sport)).toEqual({ start: 300, end: 311 });
  });

  it('gives a lone page a span of itself', () => {
    const [only] = buildDirectory([{ pageNumber: 150, title: 'X', kind: 'page' }]);
    expect(sectionSize(only)).toBe(1);
    expect(sectionRange(only)).toEqual({ start: 150, end: 150 });
  });
});
