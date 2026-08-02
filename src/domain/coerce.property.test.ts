/**
 * Tests for the never-throwing numeric coercion.
 *
 * These exist because `Number()` is not total, which is easy to forget: it
 * throws for an object that cannot be converted to a primitive. A property test
 * on `validatePublication` found it with the counterexample `{ toString: 0 }` —
 * a value a request body can carry, reaching a validator documented as never
 * throwing for any input.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toFiniteNumber, toInteger } from './coerce';

/** Objects that make bare `Number()` throw rather than return NaN. */
const HOSTILE = [
  { toString: 0 },
  { valueOf: null },
  { toString: null, valueOf: null },
  Object.create(null) as object,
  Symbol('nope'),
  { get valueOf() { throw new Error('boom'); } },
  new Proxy({}, { get() { throw new Error('trapped'); } }),
];

describe('toFiniteNumber', () => {
  it('survives values that make bare Number() throw', () => {
    for (const value of HOSTILE) {
      // Confirms the hazard is real rather than hypothetical, then that the
      // helper absorbs it.
      expect(() => toFiniteNumber(value)).not.toThrow();
      expect(toFiniteNumber(value)).toBeNull();
    }
  });

  it('at least one hostile value really does break Number()', () => {
    expect(() => Number({ toString: 0 } as unknown as number)).toThrow();
  });

  it('passes finite numbers through', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(toFiniteNumber(n)).toBe(n);
      }),
    );
  });

  it('rejects NaN and infinities', () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('parses numeric strings but not blank ones', () => {
    expect(toFiniteNumber('42')).toBe(42);
    expect(toFiniteNumber('  7.5 ')).toBe(7.5);
    // `Number('')` is 0, which is never what an empty form field means.
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
  });

  it('treats absent as absent, not as zero', () => {
    // `Number(null)` is 0 and `Number(false)` is 0; neither means "the field
    // was filled in with zero".
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber(false)).toBeNull();
    expect(toFiniteNumber(true)).toBeNull();
  });

  it('never throws for anything at all', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => toFiniteNumber(value)).not.toThrow();
      }),
    );
  });
});

describe('toInteger', () => {
  it('accepts whole numbers and rejects fractions', () => {
    expect(toInteger(5)).toBe(5);
    expect(toInteger('5')).toBe(5);
    expect(toInteger(5.5)).toBeNull();
    expect(toInteger('5.5')).toBeNull();
  });

  it('never throws for anything at all', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => toInteger(value)).not.toThrow();
      }),
    );
  });
});
