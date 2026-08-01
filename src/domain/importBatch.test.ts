import { describe, expect, it } from 'vitest';

import {
  blocksImport,
  chooseOnePerPage,
  describeIssue,
  duplicatePageNumbers,
  entryIssue,
  pageNumberFromFileName,
  parseArchiveFileName,
  sequentialPageNumbers,
  type EntryState,
} from './importBatch';
import { PLAYGROUND_MIN_PAGE } from './access';
import { MAX_PAGE, MIN_PAGE } from './pageOps';

describe('pageNumberFromFileName', () => {
  it('reads the page out of the archive’s own naming', () => {
    expect(pageNumberFromFileName('163-01.gif')).toBe(163);
    expect(pageNumberFromFileName('198-01.gif')).toBe(198);
    expect(pageNumberFromFileName('100.gif')).toBe(100);
    expect(pageNumberFromFileName('999-12.GIF')).toBe(999);
  });

  it('finds the page number among other text', () => {
    expect(pageNumberFromFileName('rtp-teletexto-163-01.gif')).toBe(163);
    expect(pageNumberFromFileName('p163.gif')).toBe(163);
    expect(pageNumberFromFileName('expo98/163-01.gif')).toBe(163);
  });

  it('skips digit groups that are not page numbers', () => {
    // A year is four digits, a subpage is two — only the three-digit group is
    // a candidate, which is what makes this unambiguous.
    expect(pageNumberFromFileName('2024-163-01.gif')).toBe(163);
    expect(pageNumberFromFileName('01-163.gif')).toBe(163);
    expect(pageNumberFromFileName('0163-01.gif')).toBeNull();
  });

  it('returns null when there is no page number to find', () => {
    expect(pageNumberFromFileName('scan.gif')).toBeNull();
    expect(pageNumberFromFileName('')).toBeNull();
    expect(pageNumberFromFileName('99-01.gif')).toBeNull();
    // 099 is three digits but below the first page.
    expect(pageNumberFromFileName('099.gif')).toBeNull();
  });

  it('does not read the extension as a page number', () => {
    expect(pageNumberFromFileName('page.163')).toBeNull();
    expect(pageNumberFromFileName('163.163')).toBe(163);
  });
});

describe('parseArchiveFileName', () => {
  it('reads page, screen and capture out of the archive’s naming', () => {
    expect(parseArchiveFileName('163-02_20010606105327.gif')).toEqual({
      pageNumber: 163,
      subpage: 2,
      capturedAt: '20010606105327',
    });
    expect(parseArchiveFileName('100-01_19980615082422.gif')).toEqual({
      pageNumber: 100,
      subpage: 1,
      capturedAt: '19980615082422',
    });
  });

  it('yields whatever parts a looser name still carries', () => {
    expect(parseArchiveFileName('163-01.gif')).toEqual({
      pageNumber: 163,
      subpage: 1,
      capturedAt: null,
    });
    expect(parseArchiveFileName('163.gif')).toEqual({
      pageNumber: 163,
      subpage: null,
      capturedAt: null,
    });
    expect(parseArchiveFileName('scan.gif')).toEqual({
      pageNumber: null,
      subpage: null,
      capturedAt: null,
    });
  });
});

describe('chooseOnePerPage', () => {
  const entry = (id: string, name: string) => ({ id, info: parseArchiveFileName(name) });

  it('keeps the newest capture of a page', () => {
    const kept = chooseOnePerPage(
      [
        entry('a', '163-01_19980615082422.gif'),
        entry('b', '163-01_20010606105327.gif'),
        entry('c', '163-01_20000427160504.gif'),
      ],
      'newest',
    );
    expect([...kept]).toEqual(['b']);
  });

  it('keeps the oldest when asked', () => {
    const kept = chooseOnePerPage(
      [entry('a', '163-01_20010606105327.gif'), entry('b', '163-01_19980615082422.gif')],
      'oldest',
    );
    expect([...kept]).toEqual(['b']);
  });

  it('prefers the first screen over later ones, whatever their dates', () => {
    const kept = chooseOnePerPage(
      [
        // A later screen captured much more recently must still lose: the page
        // number refers to the first screen.
        entry('later-screen', '163-03_20030101000000.gif'),
        entry('first-screen', '163-01_19980101000000.gif'),
      ],
      'newest',
    );
    expect([...kept]).toEqual(['first-screen']);
  });

  it('keeps one entry per distinct page', () => {
    const kept = chooseOnePerPage(
      [
        entry('a', '163-01_19980615082422.gif'),
        entry('b', '198-01_19980615082422.gif'),
        entry('c', '163-02_19980615082422.gif'),
      ],
      'newest',
    );
    expect([...kept].sort()).toEqual(['a', 'b']);
  });

  it('keeps every entry whose page number is unknown', () => {
    const kept = chooseOnePerPage(
      [entry('a', 'mystery.gif'), entry('b', 'another.gif'), entry('c', '163-01.gif')],
      'newest',
    );
    expect([...kept].sort()).toEqual(['a', 'b', 'c']);
  });

  it('lets a dated capture displace an undated one, but not the reverse', () => {
    expect([...chooseOnePerPage([entry('a', '163-01.gif'), entry('b', '163-01_2001.gif')], 'newest')])
      .toEqual(['a']);
    expect([
      ...chooseOnePerPage(
        [entry('a', '163-01.gif'), entry('b', '163-01_20010606105327.gif')],
        'newest',
      ),
    ]).toEqual(['b']);
  });

  it('is empty for an empty batch', () => {
    expect([...chooseOnePerPage([], 'newest')]).toEqual([]);
  });
});

describe('duplicatePageNumbers', () => {
  it('reports only the numbers claimed more than once', () => {
    expect([...duplicatePageNumbers([163, 198, 163, 200])]).toEqual([163]);
    expect([...duplicatePageNumbers([163, 198])]).toEqual([]);
  });

  it('does not treat unset numbers as duplicates of one another', () => {
    expect([...duplicatePageNumbers([null, null, null])]).toEqual([]);
  });
});

describe('sequentialPageNumbers', () => {
  it('runs consecutively from the start page', () => {
    expect(sequentialPageNumbers(3, PLAYGROUND_MIN_PAGE)).toEqual([700, 701, 702]);
  });

  it('gives up rather than wrapping past the last page', () => {
    expect(sequentialPageNumbers(3, MAX_PAGE - 1)).toEqual([MAX_PAGE - 1, MAX_PAGE, null]);
  });

  it('handles a start before the first page and an empty batch', () => {
    expect(sequentialPageNumbers(2, 0)).toEqual([null, null]);
    expect(sequentialPageNumbers(0, MIN_PAGE)).toEqual([]);
    expect(sequentialPageNumbers(-1, MIN_PAGE)).toEqual([]);
  });
});

describe('entryIssue', () => {
  const ready: EntryState = {
    unreadable: null,
    pageNumber: PLAYGROUND_MIN_PAGE,
    duplicate: false,
    isModerator: false,
    unknownCells: 0,
  };

  it('is null for an entry that is good to go', () => {
    expect(entryIssue(ready)).toBeNull();
  });

  it('reports the worst problem first', () => {
    // Every field is wrong at once; the unreadable file is what to say.
    expect(
      entryIssue({
        unreadable: 'Not a render',
        pageNumber: null,
        duplicate: true,
        isModerator: false,
        unknownCells: 5,
      }),
    ).toEqual({ kind: 'unreadable', detail: 'Not a render' });

    expect(entryIssue({ ...ready, pageNumber: null, duplicate: true })).toEqual({
      kind: 'no-page-number',
    });
    expect(entryIssue({ ...ready, pageNumber: 42, duplicate: true })).toEqual({
      kind: 'out-of-range',
    });
    expect(entryIssue({ ...ready, duplicate: true })).toEqual({ kind: 'duplicate' });
  });

  it('holds archive pages back from everyone but the moderator', () => {
    const archive = { ...ready, pageNumber: 163 };
    expect(entryIssue(archive)).toEqual({ kind: 'archive-locked' });
    expect(entryIssue({ ...archive, isModerator: true })).toBeNull();
  });

  it('mentions unrecognised characters only once nothing else is wrong', () => {
    expect(entryIssue({ ...ready, unknownCells: 3 })).toEqual({
      kind: 'unknown-glyphs',
      cells: 3,
    });
    expect(entryIssue({ ...ready, unknownCells: 3, duplicate: true })).toEqual({
      kind: 'duplicate',
    });
  });
});

describe('blocksImport', () => {
  it('lets an otherwise-fine page through with unrecognised characters', () => {
    expect(blocksImport({ kind: 'unknown-glyphs', cells: 9 })).toBe(false);
    expect(blocksImport(null)).toBe(false);
  });

  it('stops everything else', () => {
    for (const issue of [
      { kind: 'unreadable', detail: 'x' },
      { kind: 'no-page-number' },
      { kind: 'out-of-range' },
      { kind: 'duplicate' },
      { kind: 'archive-locked' },
    ] as const) {
      expect(blocksImport(issue)).toBe(true);
    }
  });
});

describe('describeIssue', () => {
  it('says something useful for every issue kind', () => {
    for (const issue of [
      null,
      { kind: 'unreadable', detail: 'Expected a 520x400 render' },
      { kind: 'no-page-number' },
      { kind: 'out-of-range' },
      { kind: 'duplicate' },
      { kind: 'archive-locked' },
      { kind: 'unknown-glyphs', cells: 1 },
    ] as const) {
      expect(describeIssue(issue).length).toBeGreaterThan(0);
    }
    expect(describeIssue({ kind: 'unreadable', detail: 'boom' })).toBe('boom');
    expect(describeIssue({ kind: 'unknown-glyphs', cells: 1 })).toContain('1 unrecognised character ');
  });
});
