/**
 * Pure domain logic for Member Identity and presence (Requirement 2).
 *
 * This module is framework-free (no React, no playhtml) so it can be unit- and
 * property-tested in isolation. It owns display-name validation, default
 * Identity assignment (name + color), and the clamped presence count. The
 * playhtml awareness binding in `src/collab` delegates all decisions here.
 *
 * Covered properties:
 * - Property 3: Display name validation is exactly length bounded.
 * - Property 4: Presence count matches the member list.
 */

import { ROOM_COLOR_PALETTE, ROOM_MAX_MEMBERS, type TeletextColor } from '../collab/types';

/** Minimum display-name length, inclusive. */
export const DISPLAY_NAME_MIN = 1;
/** Maximum display-name length, inclusive. */
export const DISPLAY_NAME_MAX = 32;

/**
 * Validate a member display name.
 *
 * Returns `true` iff `name` is a string whose length is between
 * {@link DISPLAY_NAME_MIN} and {@link DISPLAY_NAME_MAX} inclusive. Any other
 * value (empty, over-length, or non-string) is rejected.
 *
 * Requirements: 2.1, 2.5.
 */
export function validateDisplayName(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  return name.length >= DISPLAY_NAME_MIN && name.length <= DISPLAY_NAME_MAX;
}

/**
 * Apply a requested display-name change, retaining the previous name when the
 * requested name is invalid.
 *
 * This is the helper used by the presence binding to enforce Requirement 2.5:
 * an empty or over-length name is rejected and the member keeps their previous
 * display name.
 *
 * @returns the requested `next` name when it is valid, otherwise `previous`.
 */
export function applyDisplayName(previous: string, next: unknown): string {
  return validateDisplayName(next) ? (next as string) : previous;
}

/**
 * Build a default display name for a newly connected member.
 *
 * Produces a name of the form `Guest-XXXX` derived from `seed`. The result is
 * always between {@link DISPLAY_NAME_MIN} and {@link DISPLAY_NAME_MAX}
 * characters, so it always satisfies {@link validateDisplayName}.
 *
 * The seed (a stable session id or index) is reduced to a short uppercase
 * alphanumeric suffix so the generated name is stable per session and readable.
 *
 * Requirements: 2.1.
 */
export function defaultDisplayName(seed: string | number): string {
  const suffix = seedSuffix(seed);
  const name = `Guest-${suffix}`;
  // The prefix is 6 chars and the suffix is capped at 4, so the name is always
  // within bounds; clamp defensively to guarantee the 1..32 invariant.
  return name.slice(0, DISPLAY_NAME_MAX);
}

/**
 * Derive a stable 4-character uppercase alphanumeric suffix from a seed.
 */
function seedSuffix(seed: string | number): string {
  const raw = String(seed);
  // Simple deterministic hash so arbitrary seeds map to a compact suffix.
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  let n = hash;
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return suffix;
}

/**
 * Assign a color from the room palette for the member at the given `index`.
 *
 * The index is wrapped into the palette so any non-negative index yields a
 * valid color; negative or non-integer indices are normalized to a valid slot.
 *
 * Requirements: 2.1.
 */
export function assignColor(index: number): TeletextColor | string {
  const size = ROOM_COLOR_PALETTE.length;
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  // Wrap into range, handling negatives with a positive modulo.
  const slot = ((safe % size) + size) % size;
  return ROOM_COLOR_PALETTE[slot];
}

/**
 * Compute the displayed presence count for a set of members.
 *
 * Equals the number of members in the list, clamped to the inclusive range
 * `0..`{@link ROOM_MAX_MEMBERS}. A non-array input is treated as an empty room.
 *
 * Requirements: 2.7.
 */
export function presenceCount(members: readonly unknown[] | null | undefined): number {
  const length = Array.isArray(members) ? members.length : 0;
  if (length < 0) {
    return 0;
  }
  return Math.min(length, ROOM_MAX_MEMBERS);
}
