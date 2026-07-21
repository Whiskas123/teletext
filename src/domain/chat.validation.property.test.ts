// Feature: collaborative-teletext-rooms, Property 15: Chat message validation is exactly trimmed-length bounded
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateChatMessage } from './chat';

/**
 * Property 15: Chat message validation is exactly trimmed-length bounded.
 *
 * For any string, `validateChatMessage` accepts it iff its trimmed length is
 * between 1 and 500 inclusive; empty/whitespace-only messages are rejected with
 * reason `'empty'` and over-length messages are rejected with reason
 * `'too-long'`. Rejected messages leave the chat unchanged (validation is a
 * pure predicate here, so we assert the returned classification).
 *
 * **Validates: Requirements 5.3, 5.5, 5.6**
 */

/** Independent oracle: classify a raw string by its trimmed length. */
function oracle(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: 'empty' | 'too-long' } {
  const trimmed = raw.trim();
  if (trimmed.length < 1) return { ok: false, reason: 'empty' };
  if (trimmed.length > 500) return { ok: false, reason: 'too-long' };
  return { ok: true, value: trimmed };
}

/** Whitespace-only strings (including empty) -> should be rejected 'empty'. */
const whitespaceArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'), {
    minLength: 0,
    maxLength: 20,
  })
  .map((chars) => chars.join(''));

/** Normal-ish strings across the accept/reject boundary. */
const normalArb: fc.Arbitrary<string> = fc.string({ maxLength: 600 });

/** Very long strings guaranteed to exceed 500 trimmed chars. */
const longArb: fc.Arbitrary<string> = fc
  .integer({ min: 501, max: 1200 })
  .chain((n) => fc.string({ minLength: n, maxLength: n }));

/** A string padded with arbitrary leading/trailing whitespace. */
const paddedArb: fc.Arbitrary<string> = fc
  .tuple(whitespaceArb, fc.string({ maxLength: 600 }), whitespaceArb)
  .map(([lead, mid, trail]) => `${lead}${mid}${trail}`);

const inputArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  whitespaceArb,
  normalArb,
  longArb,
  paddedArb,
);

describe('Property 15: Chat message validation is exactly trimmed-length bounded', () => {
  it('accepts iff trimmed length is 1..500 and classifies rejections correctly', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const expected = oracle(raw);
        const actual = validateChatMessage(raw);

        expect(actual.ok).toBe(expected.ok);
        if (expected.ok && actual.ok) {
          // Accepted value is the trimmed text.
          expect(actual.value).toBe(expected.value);
          expect(actual.value.length).toBeGreaterThanOrEqual(1);
          expect(actual.value.length).toBeLessThanOrEqual(500);
        } else if (!expected.ok && !actual.ok) {
          // Rejection reason matches the trimmed-length classification.
          expect(actual.reason).toBe(expected.reason);
        }
      }),
      { numRuns: 200 },
    );
  });
});
