// Feature: English written by hand in /manage (`POST /api/snapshot?sub=`).
// Verifies: each line is matched to the screen as the database holds it — the
// Portuguese is the server's, not the request's — empty lines and positions
// that are not a line are left out, and a line longer than its cells is
// refused rather than stored to be cut on the TV. And the EN key's one read
// (`GET ?sub=all`) is public and cached at the edge.

import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { COLS, ROWS, type Cell } from '../../src/types/teletext';
import { MAX_SUBPAGE } from '../../src/domain/subpages';

const cells: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ char: ' ', fg: 'white', bg: 'black' }));
[...'Bola de ouro'].forEach((char, i) => (cells[2 * COLS + i].char = char));
[...'Golo'].forEach((char, i) => (cells[3 * COLS + i].char = char));

const writes: unknown[][] = [];
/** What `live_pages` says page 220 is called, and what `page_translations` holds. */
let ptTitle = 'Futebol';
let stored: { page_number: number; subpage: number; runs: unknown[]; title_pt: string | null; title_en: string | null }[] =
  [];
/** Each statement of a transaction: its SQL and the values bound to it. */
const transactions: { text: string; values: unknown[] }[][] = [];
vi.mock('./db', () => ({
  transaction: async (build: (sql: unknown) => unknown[]) => {
    const statements: { text: string; values: unknown[] }[] = [];
    build((strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('$'), values });
      return {};
    });
    transactions.push(statements);
    return [];
  },
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('');
    if (text.includes('select cells')) return Promise.resolve([{ cells }]);
    if (text.includes('select title')) return Promise.resolve([{ title: ptTitle }]);
    if (text.includes('from page_translations')) return Promise.resolve(stored);
    writes.push(values);
    return Promise.resolve([]);
  },
}));
vi.mock('./auth', () => ({ isAdmin: () => true }));

const { handleTranslations } = await import('./translations');

async function post(runs: unknown) {
  return send({ method: 'POST', query: { sub: '220' }, body: { runs } });
}

async function send(request: object) {
  const req = request as unknown as VercelRequest;
  const res = {
    code: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  await handleTranslations(req, res as unknown as VercelResponse);
  return res;
}

describe('English written by hand', () => {
  it('stores each line against the Portuguese the screen says now', async () => {
    writes.length = 0;
    const res = await post([
      { row: 2, col: 0, en: '  Golden ball ', pt: 'forged' },
      { row: 3, col: 0, en: '' },
      { row: 9, col: 5, en: 'not a line' },
    ]);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ key: '220', runs: [{ row: 2, col: 0, pt: 'Bola de ouro', en: 'Golden ball' }], lost: 0 });
    expect(writes).toHaveLength(1);
  });

  it('refuses a line longer than the row has room for', async () => {
    writes.length = 0;
    const res = await post([{ row: 3, col: 0, en: 'Goal! '.repeat(8) }]);
    expect(res.code).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('lists every translation for the EN key, publicly, cached at the edge', async () => {
    const res = await send({ method: 'GET', query: { sub: 'all' }, headers: {} });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ translations: {}, titles: {} });
    expect(res.headers['Cache-Control']).toMatch(/^public, .*s-maxage=60/);
  });
});

describe('translations following their screens', () => {
  const move = (moves: unknown) => send({ method: 'POST', query: { 'subs-move': '' }, body: { moves } });

  it('moves, drops and leaves alone in one transaction', async () => {
    transactions.length = 0;
    const res = await move([
      { from: '135', to: '140' },
      { from: '202.3', to: '202' },
      { from: '300', to: null },
      { from: '150', to: '150' },
    ]);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ moved: 3 });
    expect(transactions).toHaveLength(1);
    const [copy, remove, insert, copyShowcase, removeShowcase, insertShowcase] = transactions[0];
    // Every statement sees the same four columns: from page, from screen, to page, to screen.
    expect(copy.values).toEqual([[135, 202, 300], [1, 3, 1], [140, 202, null], [1, 1, null]]);
    expect(remove.values).toEqual(copy.values);
    expect(insert.text).toContain('from moving');
    // Front-page entries follow their screen the same way, or the star stays on the number.
    expect(copyShowcase.text).toContain('join showcase_pages');
    expect(copyShowcase.values).toEqual(copy.values);
    expect(removeShowcase.text).toContain('delete from showcase_pages');
    expect(removeShowcase.values).toEqual(copy.values);
    expect(insertShowcase.text).toContain('from moving_showcase');
  });

  it('refuses a move to a screen that cannot exist, and writes nothing', async () => {
    transactions.length = 0;
    const res = await move([{ from: '135', to: `135.${MAX_SUBPAGE + 1}` }]);
    expect(res.code).toBe(400);
    expect(transactions).toHaveLength(0);
  });
});

describe('a page\'s English title typed in /manage', () => {
  const save = (en: unknown, page = '220') => send({ method: 'POST', query: { 'sub-title': page }, body: { en } });

  it('goes on screen 1 against the Portuguese saved now, and clears the other screens\' titles', async () => {
    ptTitle = 'Futebol';
    transactions.length = 0;
    const res = await save('  Football ');
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ pageNumber: 220, title: { pt: 'Futebol', en: 'Football' } });
    const [clearOthers, upsert] = transactions[0];
    expect(clearOthers.text).toContain('subpage <> 1');
    expect(upsert.values).toEqual([220, 'Futebol', 'Football']);
    // Only the title: a screen's translated lines are not touched.
    expect(upsert.text).not.toMatch(/do update set[^$]*runs/);
  });

  it('empty clears it everywhere, and drops rows that held only the title', async () => {
    transactions.length = 0;
    const res = await save('');
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ pageNumber: 220, title: null });
    const [clear, drop] = transactions[0];
    expect(clear.text).not.toContain('subpage');
    expect(drop.text).toContain("runs = '[]'::jsonb");
  });

  it('refuses one for a page with no Portuguese title, or outside the archive', async () => {
    transactions.length = 0;
    ptTitle = '';
    expect((await save('Football')).code).toBe(400);
    ptTitle = 'Futebol';
    expect((await save('Football', '700')).code).toBe(400);
    expect(transactions).toHaveLength(0);
  });

  it('a row holding only a title is not listed as a translated screen', async () => {
    stored = [{ page_number: 220, subpage: 1, runs: [], title_pt: 'Futebol', title_en: 'Football' }];
    const res = await send({ method: 'GET', query: { sub: 'all' }, headers: {} });
    expect(res.body).toEqual({ translations: {}, titles: { 220: { pt: 'Futebol', en: 'Football' } } });
    stored = [];
  });
});
