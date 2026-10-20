// Feature: SUB, an English layer written into a page's own cells. Verifies:
// rows split into runs at graphics, style changes and wide gaps; numbers-only
// runs and the header row are skipped; applying keeps every cell's style; a
// stored translation applies only where the Portuguese still matches and
// no number was lost.

import { describe, expect, it } from 'vitest';

import { COLS, ROWS, type Cell, type TeletextPage } from '../types/teletext';
import { applySubtitles, keepsNumbers, subtitleRuns, translatePage, translationCoverage } from './subtitles';

function blankPage(): TeletextPage {
  return Array.from({ length: COLS * ROWS }, (): Cell => ({ char: ' ', fg: 'white', bg: 'black' }));
}

function write(page: TeletextPage, row: number, col: number, text: string, style: Partial<Cell> = {}): void {
  [...text].forEach((char, i) => Object.assign(page[row * COLS + col + i], { char, ...style }));
}

describe('subtitles', () => {
  it('cuts rows into runs a translation can fill', () => {
    const page = blankPage();
    write(page, 0, 0, 'P100 RTP Ter 12 Out');
    write(page, 2, 0, 'Bola de ouro', { fg: 'yellow' });
    write(page, 2, 12, ' 1-0'); // a score, in a new colour
    write(page, 2, 20, 'jogos   hoje'); // three blanks: two phrases
    write(page, 3, 0, 'Golo');
    page[3 * COLS + 4].graphics = 7;
    write(page, 3, 5, 'final');
    write(page, 4, 0, 'sal e a  pimenta'); // justified: still one phrase

    expect(subtitleRuns(page).map((r) => [r.row, r.start, r.end, r.text])).toEqual([
      [2, 0, 12, 'Bola de ouro'],
      [2, 20, 25, 'jogos'],
      [2, 28, 32, 'hoje'],
      [3, 0, 4, 'Golo'],
      [3, 5, 10, 'final'],
      [4, 0, 16, 'sal e a  pimenta'],
    ]);
  });

  it('writes English into the same cells, padding and clipping', () => {
    const page = blankPage();
    write(page, 5, 2, 'Tempo', { fg: 'cyan', bg: 'blue' });
    write(page, 6, 0, 'Desporto');
    const runs = subtitleRuns(page);

    const { page: out, clipped } = applySubtitles(page, runs, ['Weather', 'Sport']);
    const row = (r: number) => out.slice(r * COLS, (r + 1) * COLS).map((c) => c.char).join('');

    expect(row(5).slice(0, 8)).toBe('  Weath ');
    expect(row(6).slice(0, 9)).toBe('Sport    ');
    expect(out[5 * COLS + 2]).toMatchObject({ fg: 'cyan', bg: 'blue' });
    expect(clipped.map((r) => r.text)).toEqual(['Tempo']);
    expect(page[5 * COLS + 2].char).toBe('T'); // the original is untouched
  });

  it("draws a letter that lands on a blank in the run's colour", () => {
    const page = blankPage();
    write(page, 4, 0, 'A Estação', { fg: 'blue', bg: 'white' });
    Object.assign(page[4 * COLS + 1], { fg: 'white' }); // a space, coloured as its background

    const { page: out } = applySubtitles(page, subtitleRuns(page), ['Oriente']);
    expect(out[4 * COLS + 1]).toMatchObject({ char: 'r', fg: 'blue', bg: 'white' });
  });

  it('uses a stored translation only where the page still says the same', () => {
    const page = blankPage();
    write(page, 2, 0, 'Tempo');
    write(page, 3, 0, 'Desporto');
    const text = (p: TeletextPage, r: number) => p.slice(r * COLS, r * COLS + 8).map((c) => c.char).join('');

    const en = translatePage(page, [
      { row: 2, col: 0, pt: 'Tempo', en: 'Weather' },
      { row: 3, col: 0, pt: 'Futebol', en: 'Football' }, // made before an edit
    ]);
    expect(en && [text(en, 2), text(en, 3)]).toEqual(['Weath   ', 'Desporto']);
    expect(translatePage(page, [{ row: 9, col: 0, pt: 'Tempo', en: 'Weather' }])).toBeNull();
  });

  it('never lets a translation drop a number', () => {
    expect(keepsNumbers('1 Dia...  5 000$', '1 Day...  5 000$')).toBe(true);
    expect(keepsNumbers('de 5 mil m2', 'of 5,000 m2')).toBe(true);
    expect(keepsNumbers('Criança/3ªidade  2 500$', 'Child/Senior  2 500$')).toBe(true);
    expect(keepsNumbers('1 Dia...  5 000$', '1 Day...........')).toBe(false);

    const page = blankPage();
    write(page, 2, 0, '1 Dia..  5 000$');
    const en = translatePage(page, [{ row: 2, col: 0, pt: '1 Dia..  5 000$', en: '1 Day..........' }]);
    expect(en).toBeNull(); // the only entry lost the price, so nothing applies
  });

  it('counts how much of a page a translation still covers', () => {
    const page = blankPage();
    write(page, 2, 0, 'Tempo');
    write(page, 3, 0, 'Desporto');
    const stored = [
      { row: 2, col: 0, pt: 'Tempo', en: 'Clima' },
      { row: 3, col: 0, pt: 'Desporto', en: 'Sport' },
    ];
    expect(translationCoverage(page, stored)).toEqual({ matched: 2, total: 2 });
    write(page, 3, 0, 'Futebol '); // edited after translation
    expect(translationCoverage(page, stored)).toEqual({ matched: 1, total: 2 });
    expect(translationCoverage(page, [])).toEqual({ matched: 0, total: 2 });
  });
});
