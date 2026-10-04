// Splitting live writes: every piece under the budget, content before the
// screens it left are emptied, and nothing written that did not change.

import { describe, expect, it } from 'vitest';

import { changedEntries, chunkEntries, isEmptyValue, orderedWrites, type LiveEntry } from './liveWrites';

const screen = (char: string, cells = 960) =>
  Object.fromEntries(Array.from({ length: cells }, (_, index) => [index, { char, fg: 'white', bg: 'black' }]));

const weight = (write: LiveEntry<unknown>[]) =>
  write.reduce((sum, [key, value]) => sum + key.length + JSON.stringify(value ?? null).length, 0);

describe('splitting a write', () => {
  it('keeps every piece under the budget, in order, losing nothing', () => {
    const entries = Array.from({ length: 50 }, (_, index) => [String(100 + index), screen('A')] as const);
    const budget = 3 * JSON.stringify(screen('A')).length + 20;
    const chunks = chunkEntries(entries, budget);

    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) expect(weight(chunk)).toBeLessThanOrEqual(budget);
    expect(chunks.flat()).toEqual(entries);
  });

  it('gives an entry bigger than the budget a piece of its own', () => {
    const chunks = chunkEntries<unknown>([['1', screen('A')], ['2', 'x'], ['3', 'y']], 100);
    expect(chunks.map((chunk) => chunk.map(([key]) => key))).toEqual([['1'], ['2', '3']]);
  });

  it('writes content first and empties the screens left behind last', () => {
    const writes = orderedWrites([
      ['119', {}],
      ['118', screen('P')],
      ['138.3', {}],
      ['137.3', screen('R')],
    ]);
    expect(writes.at(-1)).toEqual([
      ['119', {}],
      ['138.3', {}],
    ]);
    expect(writes.slice(0, -1).flat().map(([key]) => key)).toEqual(['118', '137.3']);
  });
});

describe('what changed', () => {
  it('leaves out keys rewritten with what they held, and treats missing as empty', () => {
    const live = { 100: screen('A'), 101: screen('B') };
    const result = { '100': screen('A'), '101': screen('C'), '102': {} };
    expect(changedEntries(result, live).map(([key]) => key)).toEqual(['101']);
  });

  it('knows an empty screen', () => {
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(screen('A', 1))).toBe(false);
  });
});
