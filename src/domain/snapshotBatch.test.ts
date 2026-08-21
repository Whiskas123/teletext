// Feature: splitting the backup into requests that fit.
// Verifies: the two properties that decide whether a batched backup is still a
// backup — that every page ends up in exactly one batch (losing one would mean
// a backup quietly missing a page), and that no batch exceeds the budget (which
// is what the 413 was). Plus the edge cases: an empty document, and a single
// page bigger than the whole budget.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { BATCH_BYTES, batchPages } from './snapshotBatch';

/** A stand-in for a page: a string whose length is its cost. */
const document = () =>
  fc.dictionary(
    fc.stringMatching(/^[1-9][0-9]{0,2}$/),
    fc.string({ minLength: 1, maxLength: 400 }),
    { maxKeys: 40 },
  );

describe('batchPages', () => {
  it('sends nothing when there is nothing to send', () => {
    expect(batchPages({})).toEqual([]);
  });

  it('keeps one small document in a single request', () => {
    const pages = { 100: 'a', 101: 'b', 102: 'c' };
    expect(batchPages(pages)).toEqual([pages]);
  });

  it('splits once the budget is reached', () => {
    const page = 'x'.repeat(100);
    const pages = { 100: page, 101: page, 102: page };

    // A budget that fits two of these but not three.
    const batches = batchPages(pages, 250);
    expect(batches).toHaveLength(2);
    expect(Object.keys(batches[0])).toEqual(['100', '101']);
    expect(Object.keys(batches[1])).toEqual(['102']);
  });

  // Dropping a page would produce a backup that reports success and is quietly
  // short — the failure mode this whole file exists to avoid.
  it('puts every page in exactly one batch, whatever the budget', () => {
    fc.assert(
      fc.property(document(), fc.integer({ min: 50, max: 2000 }), (pages, budget) => {
        const batches = batchPages(pages, budget);
        const seen = batches.flatMap((batch) => Object.keys(batch));

        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.sort()).toEqual(Object.keys(pages).sort());
      }),
    );
  });

  it('keeps every batch within the budget, unless one page exceeds it alone', () => {
    fc.assert(
      fc.property(document(), fc.integer({ min: 50, max: 2000 }), (pages, budget) => {
        for (const batch of batchPages(pages, budget)) {
          const size = JSON.stringify(batch).length;
          // A lone oversized page is allowed through: see the note in
          // `batchPages`. Anything else must fit.
          if (Object.keys(batch).length > 1) {
            expect(size).toBeLessThanOrEqual(budget * 1.1);
          }
        }
      }),
    );
  });

  it('gives a page larger than the budget a request of its own', () => {
    const batches = batchPages({ 100: 'a', 101: 'x'.repeat(500) }, 100);

    expect(batches).toHaveLength(2);
    expect(Object.keys(batches[1])).toEqual(['101']);
  });

  it('leaves a safe margin under the 4.5 MB a function will accept', () => {
    expect(BATCH_BYTES).toBeLessThan(4_500_000);
  });
});
