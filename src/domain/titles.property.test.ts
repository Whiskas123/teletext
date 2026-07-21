// Feature: collaborative-teletext-rooms, Property 21: Title validation trims and is length bounded with empty default
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_TITLE_LENGTH, readTitle, validateTitle } from './titles';
import type { TitlesData } from '../collab/types';

/**
 * Property 21: Title validation trims and is length bounded with empty default.
 *
 * For any string, `validateTitle` accepts it iff its trimmed length is between
 * 0 and 60 inclusive, returning the trimmed value (a whitespace-only or empty
 * input yields a title of length 0); a trimmed length above 60 is rejected with
 * reason `'too-long'` (the caller retains the current title); and a Page_Number
 * with no stored title reads as a title of length 0 via `readTitle`.
 *
 * **Validates: Requirements 9.2, 9.4, 9.6**
 */

/** Independent oracle: classify a raw string by its trimmed length. */
function oracle(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: 'too-long' } {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, value: trimmed };
}

/** Whitespace-only strings (including empty) -> trim to a length-0 title. */
const whitespaceArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'), {
    minLength: 0,
    maxLength: 20,
  })
  .map((chars) => chars.join(''));

/** Normal-ish strings straddling the 0..60 accept/reject boundary. */
const normalArb: fc.Arbitrary<string> = fc.string({ maxLength: 80 });

/**
 * Strings guaranteed to have a trimmed length above 60 (non-whitespace core so
 * trimming cannot pull them back into range).
 */
const longArb: fc.Arbitrary<string> = fc
  .integer({ min: MAX_TITLE_LENGTH + 1, max: 200 })
  .chain((n) =>
    fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: n,
      maxLength: n,
    }),
  )
  .map((chars) => chars.join(''));

/** A string padded with arbitrary leading/trailing whitespace. */
const paddedArb: fc.Arbitrary<string> = fc
  .tuple(whitespaceArb, fc.string({ maxLength: 80 }), whitespaceArb)
  .map(([lead, mid, trail]) => `${lead}${mid}${trail}`);

const inputArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  whitespaceArb,
  normalArb,
  longArb,
  paddedArb,
);

describe('Property 21: Title validation trims and is length bounded with empty default', () => {
  it('accepts iff trimmed length is 0..60, returning the trimmed value', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const expected = oracle(raw);
        const actual = validateTitle(raw);

        expect(actual.ok).toBe(expected.ok);
        if (expected.ok && actual.ok) {
          // Accepted value is exactly the trimmed text, length-bounded 0..60.
          expect(actual.value).toBe(expected.value);
          expect(actual.value).toBe(raw.trim());
          expect(actual.value.length).toBeGreaterThanOrEqual(0);
          expect(actual.value.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        } else if (!expected.ok && !actual.ok) {
          // Over-length titles are rejected with reason 'too-long'.
          expect(actual.reason).toBe('too-long');
          expect(raw.trim().length).toBeGreaterThan(MAX_TITLE_LENGTH);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('treats whitespace-only and empty input as a length-0 title', () => {
    fc.assert(
      fc.property(whitespaceArb, (raw) => {
        const actual = validateTitle(raw);
        expect(actual.ok).toBe(true);
        if (actual.ok) {
          expect(actual.value).toBe('');
          expect(actual.value.length).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('reads a stored title when present, else a length-0 title for absent keys', () => {
    const pageNumberArb = fc.integer({ min: 1, max: 999 });
    // A sparse titles map keyed by Page_Number, plus an occasionally-absent map.
    const titlesArb: fc.Arbitrary<TitlesData | undefined> = fc.oneof(
      fc.constant(undefined),
      fc.dictionary(
        pageNumberArb.map((n) => String(n)),
        fc.string({ maxLength: 60 }),
      ) as unknown as fc.Arbitrary<TitlesData>,
    );

    fc.assert(
      fc.property(titlesArb, pageNumberArb, (titles, pageNumber) => {
        const stored = titles?.[pageNumber];
        const expected = typeof stored === 'string' ? stored : '';
        expect(readTitle(titles, pageNumber)).toBe(expected);
        // Absent keys / undefined maps always read as a length-0 title.
        if (typeof stored !== 'string') {
          expect(readTitle(titles, pageNumber)).toBe('');
          expect(readTitle(titles, pageNumber).length).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
