// Feature: English written by hand in /manage (`POST /api/snapshot?sub=`).
// Verifies: each line is matched to the screen as the database holds it — the
// Portuguese is the server's, not the request's — empty lines and positions
// that are not a line are left out, and a line longer than its cells is
// refused rather than stored to be cut on the TV. And the EN key's one read
// (`GET ?sub=all`) is public and cached at the edge.

import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { COLS, ROWS, type Cell } from '../../src/types/teletext';

const cells: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ char: ' ', fg: 'white', bg: 'black' }));
[...'Bola de ouro'].forEach((char, i) => (cells[2 * COLS + i].char = char));
[...'Golo'].forEach((char, i) => (cells[3 * COLS + i].char = char));

const writes: unknown[][] = [];
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
    if (strings.join('').includes('select cells')) return Promise.resolve([{ cells }]);
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

  it('refuses a line longer than its cells', async () => {
    writes.length = 0;
    const res = await post([{ row: 3, col: 0, en: 'Goal!!' }]);
    expect(res.code).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('lists every translation for the EN key, publicly, cached at the edge', async () => {
    const res = await send({ method: 'GET', query: { sub: 'all' }, headers: {} });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ translations: {} });
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
    const [copy, remove, insert] = transactions[0];
    // Every statement sees the same four columns: from page, from screen, to page, to screen.
    expect(copy.values).toEqual([[135, 202, 300], [1, 3, 1], [140, 202, null], [1, 1, null]]);
    expect(remove.values).toEqual(copy.values);
    expect(insert.text).toContain('from moving');
  });

  it('refuses a move to a screen that cannot exist, and writes nothing', async () => {
    transactions.length = 0;
    const res = await move([{ from: '135', to: '135.99' }]);
    expect(res.code).toBe(400);
    expect(transactions).toHaveLength(0);
  });
});
