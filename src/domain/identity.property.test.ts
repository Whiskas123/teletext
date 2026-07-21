// Feature: collaborative-teletext-rooms, Property 3: Display name validation is exactly length bounded
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  applyDisplayName,
  defaultDisplayName,
  validateDisplayName,
} from './identity';

/**
 * Property 3: Display name validation is exactly length bounded.
 *
 * For any string, `validateDisplayName` accepts it iff its length is between 1
 * and 32 inclusive; a rejected name leaves the member's previous name
 * unchanged (`applyDisplayName`), and any assigned default Identity name
 * (`defaultDisplayName`) satisfies this bound.
 *
 * Validates: Requirements 2.1, 2.5
 */
describe('Property 3: Display name validation is exactly length bounded', () => {
  it('accepts a string iff its length is within [1, 32]', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (name) => {
        const expected = name.length >= DISPLAY_NAME_MIN && name.length <= DISPLAY_NAME_MAX;
        expect(validateDisplayName(name)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('applyDisplayName returns the next name when valid and the previous name when rejected', () => {
    fc.assert(
      fc.property(
        // previous is always a valid display name so the "retain" case is meaningful
        fc.string({ minLength: DISPLAY_NAME_MIN, maxLength: DISPLAY_NAME_MAX }),
        fc.string({ maxLength: 64 }),
        (previous, next) => {
          const result = applyDisplayName(previous, next);
          if (validateDisplayName(next)) {
            expect(result).toBe(next);
          } else {
            expect(result).toBe(previous);
          }
          // Regardless of outcome, the resulting name is always valid.
          expect(validateDisplayName(result)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('defaultDisplayName always satisfies validateDisplayName for arbitrary seeds', () => {
    const seedArb = fc.oneof(
      fc.string({ maxLength: 128 }),
      fc.integer(),
      fc.double({ noNaN: true }),
    );
    fc.assert(
      fc.property(seedArb, (seed) => {
        const name = defaultDisplayName(seed);
        expect(validateDisplayName(name)).toBe(true);
        expect(name.length).toBeGreaterThanOrEqual(DISPLAY_NAME_MIN);
        expect(name.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
      }),
      { numRuns: 200 },
    );
  });
});
