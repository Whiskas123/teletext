// Reading a title off the top of a page: skipping the header, the dates and
// the graphics, and joining a short section banner to the headline under it.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createEmptyPage, type TeletextPage } from '../types/teletext';
import { suggestTitle } from './suggestTitle';
import { MAX_TITLE_LENGTH } from './titles';

function page(lines: Record<number, string>): TeletextPage {
  const cells = createEmptyPage();
  for (const [row, text] of Object.entries(lines)) {
    for (let col = 0; col < Math.min(40, text.length); col += 1) {
      cells[Number(row) * 40 + col] = { ...cells[Number(row) * 40 + col], char: text[col] };
    }
  }
  return cells;
}

describe('suggestTitle', () => {
  it('skips the broadcaster header and takes the first line of words', () => {
    expect(
      suggestTitle(page({ 0: 'SIC 201  Qua 12 Mar  22:31:07', 2: 'Governo aprova orçamento' })),
    ).toBe('Governo aprova orçamento');
  });

  it('joins a short section banner to the headline under it', () => {
    expect(suggestTitle(page({ 1: 'D E S P O R T O', 3: 'Benfica vence em Braga' }))).toBe(
      'DESPORTO — Benfica vence em Braga',
    );
  });

  it('passes over rows of numbers, prices and graphics', () => {
    expect(
      suggestTitle(page({ 1: '12/03/2008', 2: '1.234,56  +0,4%', 3: '--------', 4: 'Bolsa de Lisboa fecha em alta' })),
    ).toBe('Bolsa de Lisboa fecha em alta');
  });

  it('strips trailing punctuation and leader dots', () => {
    expect(suggestTitle(page({ 2: 'Farmácias de serviço .......' }))).toBe('Farmácias de serviço');
  });

  it('says nothing for a page with no words', () => {
    expect(suggestTitle(createEmptyPage())).toBe('');
    expect(suggestTitle(page({ 3: '100 200 300 400' }))).toBe('');
  });

  it('never returns more than a title may hold', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 0, maxLength: 40 }), { maxLength: 24 }), (rows) => {
        const lines = Object.fromEntries(rows.map((text, row) => [row, text]));
        expect(suggestTitle(page(lines)).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      }),
    );
  });
});
