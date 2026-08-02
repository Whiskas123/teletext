/**
 * Turning untrusted values into numbers without ever throwing.
 *
 * `Number(value)` looks total and is not. For an object it invokes the usual
 * primitive conversion, and if that cannot produce a primitive it throws:
 *
 * ```js
 * Number({ toString: 0 })  // TypeError: Cannot convert object to primitive value
 * ```
 *
 * `toString` is not callable there, and the inherited `valueOf` returns the
 * object itself, so JavaScript gives up — with an exception rather than `NaN`.
 * The same happens for `{ valueOf: null }`, for a `Symbol`, and for a `Proxy`
 * whose traps throw.
 *
 * That matters because these values arrive in request bodies. A validator that
 * says it "never throws for any input" and then calls `Number` on a field is
 * one crafted object away from a 500, and the object is trivial to craft. A
 * property test found exactly that in `validatePublication` with the
 * counterexample `{ toString: 0 }`.
 */

/**
 * `value` as a finite number, or `null` for anything that is not one.
 *
 * `null` covers every failure the same way: not numeric, `NaN`, `Infinity`, an
 * object that refuses to become a primitive. Callers get one case to handle
 * rather than a mix of sentinel values and exceptions.
 *
 * `null` and `undefined` are *not* treated as `0`, which is what `Number` does
 * for `null` — an absent field is absent, not zero.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  // A blank string is 0 to `Number`, which is never what an absent field means.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'boolean' || value == null) return null;

  // Objects and symbols: conversion can throw, so it is attempted defensively
  // rather than guarded by type-sniffing that would miss a hostile `Proxy`.
  try {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `value` as an integer, or `null` if it is not a finite whole number. */
export function toInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : null;
}
