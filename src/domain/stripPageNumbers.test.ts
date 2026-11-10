import { expect, it } from 'vitest';

import { COLS, createEmptyPage, type TeletextPage } from '../types/teletext';
import { stripPageNumbers } from './stripPageNumbers';

function pageWith(rows: Record<number, string>): TeletextPage {
  const page = createEmptyPage();
  for (const [row, text] of Object.entries(rows)) {
    [...text].forEach((char, col) => {
      page[Number(row) * COLS + col] = { ...page[Number(row) * COLS + col], char, fg: 'yellow' };
    });
  }
  return page;
}

const rowText = (page: TeletextPage, row: number) =>
  page.slice(row * COLS, (row + 1) * COLS).map((cell) => cell.char).join('').trimEnd();

it('blanks three-digit runs and leaves longer and shorter numbers', () => {
  const page = pageWith({
    1: 'Noticias..... 120 Tempo 401',
    2: 'Ajuda:pag 151  1/20  2004  4460 3,50',
    3: '999',
  });
  const { page: out, removed } = stripPageNumbers(page);
  expect(rowText(out, 1)).toBe('Noticias.....     Tempo');
  expect(rowText(out, 2)).toBe('Ajuda:pag      1/20  2004  4460 3,50');
  expect(rowText(out, 3)).toBe('');
  expect(removed).toBe(4);
  // Colours stay, so a blanked number does not punch a hole in a coloured strip.
  expect(out[1 * COLS + 14].fg).toBe('yellow');
  // The input is not touched.
  expect(rowText(page, 1)).toBe('Noticias..... 120 Tempo 401');
});

it('does not join digits across rows, skips graphics, and keeps the row it is told to', () => {
  const page = pageWith({ 4: `${' '.repeat(38)}12`, 5: '3', 23: 'Indice 100' });
  page[6 * COLS] = { ...page[6 * COLS], char: '1', graphics: 5 };
  page[6 * COLS + 1] = { ...page[6 * COLS + 1], char: '2' };
  page[6 * COLS + 2] = { ...page[6 * COLS + 2], char: '3' };
  const { page: out, removed } = stripPageNumbers(page, 23);
  expect(removed).toBe(0);
  expect(rowText(out, 23)).toBe('Indice 100');
});
