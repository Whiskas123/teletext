// Feature: collaborative-teletext-rooms, Property 2: Generated Room_IDs are always valid and collision-free
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { generateRoomId, validateRoomId } from './roomId';

/**
 * Property 2: Generated Room_IDs are always valid and collision-free.
 *
 * For any set of existing Room_IDs, `generateRoomId(existing)` returns a string
 * of length between 8 and 64 containing only letters, digits, and hyphens, that
 * is not a member of the existing set (and therefore also passes
 * `validateRoomId`).
 *
 * Note: `generateRoomId` uses `Math.random`, so it is non-deterministic. That is
 * acceptable here — the property must hold for every produced value regardless
 * of the random draw.
 *
 * **Validates: Requirements 1.2**
 */

const CHARSET_PATTERN = /^[A-Za-z0-9-]+$/;

describe('Property 2: Generated Room_IDs are always valid and collision-free', () => {
  it('generates valid, collision-free Room_IDs for any set of existing IDs', () => {
    fc.assert(
      fc.property(
        // Arbitrary sets of existing Room_IDs: arrays of arbitrary strings,
        // deduplicated into a Set. Includes empty sets, plausible IDs, and
        // arbitrary noise strings.
        fc.array(fc.string(), { maxLength: 50 }),
        (existingArray) => {
          const existing = new Set(existingArray);
          const id = generateRoomId(existing);

          // Length bounds 8..64 inclusive (Req 1.2).
          expect(id.length).toBeGreaterThanOrEqual(8);
          expect(id.length).toBeLessThanOrEqual(64);

          // Charset: only letters, digits, and hyphens (Req 1.2).
          expect(id).toMatch(CHARSET_PATTERN);

          // Not a member of the existing set (collision-free) (Req 1.2).
          expect(existing.has(id)).toBe(false);

          // Consequently passes validateRoomId (Req 1.2).
          expect(validateRoomId(id)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('generates collision-free IDs even when existing already contains generated-shaped IDs', () => {
    fc.assert(
      fc.property(
        // Pre-seed the existing set with alphanumeric strings shaped like
        // generated IDs to exercise the collision-avoidance path.
        fc.array(
          fc.stringMatching(/^[A-Za-z0-9]{8}$/),
          { maxLength: 30 },
        ),
        (existingArray) => {
          const existing = existingArray;
          const id = generateRoomId(existing);

          expect(id.length).toBeGreaterThanOrEqual(8);
          expect(id.length).toBeLessThanOrEqual(64);
          expect(id).toMatch(CHARSET_PATTERN);
          expect(existing.includes(id)).toBe(false);
          expect(validateRoomId(id)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
