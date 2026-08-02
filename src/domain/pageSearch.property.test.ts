/**
 * Tests for searching pages by their text.
 *
 * The cases that matter are the ones peculiar to a teletext grid: graphics
 * cells hold a meaningless `char` that must not splice noise into words, layout
 * is done with padding so runs of blanks have to collapse, and the archive is
 * Portuguese so accents cannot be required of whoever is typing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MIN_QUERY_LENGTH,
  foldForSearch,
  pageRows,
  pageText,
  rowText,
  searchPages,
  type SearchablePage,
} from './pageSearch';
import { COLS, ROWS, createEmptyPage, type TeletextPage } from '../types/teletext';

/** Write `text` at a row, as the editor would. */
function write(page: TeletextPage, row: number, col: number, text: string): TeletextPage {
  for (let i = 0; i < text.length; i += 1) {
    page[row * COLS + col + i] = {
      char: text[i],
      fg: 'white',
      bg: 'black',
      graphics: null,
    };
  }
  return page;
}

function pageWith(row: number, col: number, text: string): TeletextPage {
  return write(createEmptyPage(), row, col, text);
}

describe('foldForSearch', () => {
  it('folds case and strips accents', () => {
    expect(foldForSearch('Eleições')).toBe('eleicoes');
    expect(foldForSearch('NOTÍCIAS')).toBe('noticias');
    expect(foldForSearch('Ação')).toBe('acao');
  });

  it('keeps one character per original character', () => {
    // Offsets are used against the untouched text, so folding must not change
    // the length or a snippet would be sliced in the wrong place.
    for (const word of ['Eleições', 'ÁÉÍÓÚ', 'plain', 'Ç']) {
      expect(foldForSearch(word)).toHaveLength(word.length);
    }
  });

  it('never throws on odd input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => foldForSearch(text)).not.toThrow();
      }),
    );
  });
});

describe('rowText', () => {
  it('reads a row left to right', () => {
    expect(rowText(pageWith(3, 0, 'HELLO'), 3)).toBe('HELLO');
  });

  it('collapses the padding teletext lays things out with', () => {
    const page = pageWith(0, 0, 'NEWS');
    write(page, 0, 30, '201');
    expect(rowText(page, 0)).toBe('NEWS 201');
  });

  it('reads a graphics cell as a gap, not as its stale character', () => {
    // A mosaic cell keeps whatever char was last typed there; treating it as
    // text would splice noise into the middle of a word.
    const page = pageWith(0, 0, 'ABC');
    page[1] = { char: 'X', fg: 'white', bg: 'black', graphics: 0b101010 };
    expect(rowText(page, 0)).toBe('A C');
  });

  it('is empty for an empty row', () => {
    expect(rowText(createEmptyPage(), 5)).toBe('');
  });
});

describe('pageRows and pageText', () => {
  it('returns one entry per row so row numbers line up', () => {
    expect(pageRows(createEmptyPage())).toHaveLength(ROWS);
  });

  it('repairs anything malformed rather than throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => pageRows(input)).not.toThrow();
        expect(pageRows(input)).toHaveLength(ROWS);
      }),
    );
  });

  it('joins rows with newlines', () => {
    const page = pageWith(0, 0, 'ONE');
    write(page, 1, 0, 'TWO');
    expect(pageText(page).split('\n').slice(0, 2)).toEqual(['ONE', 'TWO']);
  });
});

describe('searchPages', () => {
  const pages: SearchablePage[] = [
    { pageNumber: 200, title: 'Notícias', page: pageWith(4, 2, 'ELEICOES HOJE') },
    { pageNumber: 300, title: 'Desporto', page: pageWith(6, 0, 'BENFICA 2 PORTO 1') },
    { pageNumber: 400, title: 'Finance', page: createEmptyPage() },
  ];

  it('finds a word in a page body', () => {
    const hits = searchPages(pages, 'BENFICA');
    expect(hits.map((h) => h.pageNumber)).toEqual([300]);
    expect(hits[0].row).toBe(6);
    expect(hits[0].inTitle).toBe(false);
  });

  it('finds a word regardless of case or accents', () => {
    // Nobody hunting for eleições should have to type the ç and the õ.
    expect(searchPages(pages, 'eleicoes').map((h) => h.pageNumber)).toEqual([200]);
    expect(searchPages(pages, 'noticias').map((h) => h.pageNumber)).toEqual([200]);
    expect(searchPages(pages, 'NOTÍCIAS').map((h) => h.pageNumber)).toEqual([200]);
  });

  it('marks a title match as such', () => {
    const [hit] = searchPages(pages, 'Desporto');
    expect(hit.inTitle).toBe(true);
    expect(hit.row).toBeNull();
  });

  it('lists a page once, at its first match', () => {
    const page = pageWith(2, 0, 'GOAL');
    write(page, 9, 0, 'GOAL AGAIN');
    const hits = searchPages([{ pageNumber: 500, title: '', page }], 'GOAL');
    expect(hits).toHaveLength(1);
    expect(hits[0].row).toBe(2);
  });

  it('returns results in ascending page order', () => {
    const many: SearchablePage[] = [
      { pageNumber: 400, title: 'x', page: pageWith(0, 0, 'SAME') },
      { pageNumber: 200, title: 'x', page: pageWith(0, 0, 'SAME') },
      { pageNumber: 300, title: 'x', page: pageWith(0, 0, 'SAME') },
    ];
    expect(searchPages(many, 'SAME').map((h) => h.pageNumber)).toEqual([200, 300, 400]);
  });

  it('refuses a query too short to mean anything', () => {
    expect(searchPages(pages, 'B')).toEqual([]);
    expect(searchPages(pages, ' ')).toEqual([]);
    expect(searchPages(pages, '')).toEqual([]);
    expect(MIN_QUERY_LENGTH).toBeGreaterThan(1);
  });

  it('gives a snippet with offsets that land on the match', () => {
    const page = pageWith(0, 0, 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG');
    const [hit] = searchPages([{ pageNumber: 100, title: '', page }], 'JUMPS');
    expect(hit.match).not.toBeNull();
    if (hit.match != null) {
      expect(hit.snippet.slice(hit.match.start, hit.match.end).toLowerCase()).toBe('jumps');
    }
  });

  it('keeps snippet offsets right for accented text', () => {
    const page = pageWith(0, 0, 'AS ELEIÇÕES DE HOJE');
    const [hit] = searchPages([{ pageNumber: 100, title: '', page }], 'eleicoes');
    expect(hit.match).not.toBeNull();
    if (hit.match != null) {
      expect(hit.snippet.slice(hit.match.start, hit.match.end)).toBe('ELEIÇÕES');
    }
  });

  it('finds nothing in an empty page', () => {
    expect(searchPages(pages, 'zzzz')).toEqual([]);
  });

  it('never throws, and drops entries that are not pages', () => {
    // The listing comes from playhtml, which any client can write to.
    fc.assert(
      fc.property(fc.array(fc.anything()), fc.string(), (input, query) => {
        expect(() => searchPages(input as SearchablePage[], query)).not.toThrow();
      }),
    );
    const mixed = [
      null,
      { pageNumber: 'nope' },
      { pageNumber: 200, page: pageWith(0, 0, 'FINDME') },
    ] as never;
    expect(searchPages(mixed, 'FINDME').map((h) => h.pageNumber)).toEqual([200]);
  });
});
