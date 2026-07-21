// Feature: collaborative-teletext-rooms, Property 1: Room_ID validation is exactly charset + length bounded
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateRoomId } from './roomId';

/**
 * Property 1: Room_ID validation is exactly charset + length bounded.
 *
 * For any string, `validateRoomId` returns true iff its length is between 1 and
 * 64 inclusive and it contains only letters, digits, and hyphens; otherwise it
 * returns false.
 *
 * Validates: Requirements 1.3, 1.4, 1.5
 */

const NUM_RUNS = 200;

/**
 * Independent oracle: computed differently from the implementation. Uses an
 * explicit per-character set membership check and length bounds rather than a
 * single anchored regex, so it does not merely mirror the production code.
 */
const VALID_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
);

function oracle(id: string): boolean {
  if (id.length < 1 || id.length > 64) {
    return false;
  }
  for (const ch of id) {
    if (!VALID_CHARS.has(ch)) {
      return false;
    }
  }
  return true;
}

// Characters guaranteed to be inside the valid charset.
const validCharArb = fc.constantFrom(
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
);

// A well-formed valid Room_ID: length 1..64 from the valid charset only.
const validRoomIdArb = fc
  .array(validCharArb, { minLength: 1, maxLength: 64 })
  .map((chars) => chars.join(''));

// A valid-charset string of length > 64 (too long, must be rejected).
const tooLongArb = fc
  .array(validCharArb, { minLength: 65, maxLength: 200 })
  .map((chars) => chars.join(''));

// A single character guaranteed to be outside the valid Room_ID charset.
const invalidCharArb = fc
  .integer({ min: 0x20, max: 0x2fff })
  .map((cp) => String.fromCodePoint(cp))
  .filter((ch) => !VALID_CHARS.has(ch));

// A string that contains at least one character outside the valid charset.
const withInvalidCharArb = fc
  .tuple(
    fc.array(validCharArb, { minLength: 0, maxLength: 30 }),
    invalidCharArb,
    fc.array(validCharArb, { minLength: 0, maxLength: 30 }),
  )
  .map(([before, bad, after]) => [...before, bad, ...after].join(''));

describe('Property 1: Room_ID validation is exactly charset + length bounded', () => {
  it('validateRoomId matches the independent length+charset oracle for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 80 }), (id) => {
        expect(validateRoomId(id)).toBe(oracle(id));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts well-formed valid Room_IDs (length 1..64, valid charset)', () => {
    fc.assert(
      fc.property(validRoomIdArb, (id) => {
        expect(validateRoomId(id)).toBe(true);
        expect(oracle(id)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects the empty string', () => {
    expect(validateRoomId('')).toBe(false);
    expect(oracle('')).toBe(false);
  });

  it('rejects valid-charset strings longer than 64 characters', () => {
    fc.assert(
      fc.property(tooLongArb, (id) => {
        expect(validateRoomId(id)).toBe(false);
        expect(oracle(id)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects strings containing any character outside letters, digits, and hyphens', () => {
    fc.assert(
      fc.property(withInvalidCharArb, (id) => {
        expect(validateRoomId(id)).toBe(false);
        expect(oracle(id)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
