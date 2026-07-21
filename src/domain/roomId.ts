/**
 * Room_ID domain logic for Collaborative Teletext Rooms.
 *
 * A Room_ID is a human-usable string that uniquely identifies a Room and serves
 * as the playhtml room namespace. This module is pure and framework-free (no
 * React, no playhtml) so it can be exhaustively property-tested without a live
 * server.
 *
 * _Requirements: 1.2, 1.3, 1.4, 1.5_
 */

/** Minimum length of any valid Room_ID (Req 1.3, 1.4). */
const MIN_ROOM_ID_LENGTH = 1;

/** Maximum length of any valid Room_ID (Req 1.3, 1.4, 1.5). */
const MAX_ROOM_ID_LENGTH = 64;

/** Minimum length of a *generated* Room_ID (Req 1.2). */
const MIN_GENERATED_LENGTH = 8;

/**
 * The full charset a Room_ID may contain: letters, digits, and hyphens.
 * Anchored so the entire string must match (no other characters allowed).
 */
const ROOM_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * The alphabet used to generate Room_IDs. Restricted to letters and digits
 * (no hyphen) so generated IDs read cleanly; every character is within the
 * valid Room_ID charset.
 */
const GENERATION_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Validate a Room_ID.
 *
 * Returns `true` iff `id` has a length between {@link MIN_ROOM_ID_LENGTH} and
 * {@link MAX_ROOM_ID_LENGTH} inclusive and contains only letters, digits, and
 * hyphens; otherwise returns `false`. Total: never throws for any string input.
 *
 * _Requirements: 1.3, 1.4, 1.5_
 */
export function validateRoomId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  if (id.length < MIN_ROOM_ID_LENGTH || id.length > MAX_ROOM_ID_LENGTH) {
    return false;
  }
  return ROOM_ID_PATTERN.test(id);
}

/**
 * Generate a new Room_ID that is valid and not already in use.
 *
 * The returned string has a length between {@link MIN_GENERATED_LENGTH} and
 * {@link MAX_ROOM_ID_LENGTH}, contains only characters from
 * {@link GENERATION_ALPHABET} (a subset of the valid Room_ID charset), and is
 * not a member of `existing`. It therefore also passes {@link validateRoomId}.
 *
 * @param existing Room_IDs already in use, as a `Set` or array.
 * _Requirements: 1.2_
 */
export function generateRoomId(existing: Set<string> | string[]): string {
  const taken = existing instanceof Set ? existing : new Set(existing);

  // Length 8 gives 62^8 (~2.18e14) possibilities, so collisions are rare; the
  // loop guarantees correctness even so. We grow the length as a defensive
  // fallback in the improbable case that many candidates collide, staying
  // within the 64-character bound.
  let length = MIN_GENERATED_LENGTH;

  // Bounded retry: after several collisions at a given length, grow the length
  // (up to the max) to expand the keyspace and guarantee termination.
  for (let attempt = 0; ; attempt += 1) {
    const candidate = randomString(length);
    if (!taken.has(candidate)) {
      return candidate;
    }
    if (attempt > 0 && attempt % 8 === 0 && length < MAX_ROOM_ID_LENGTH) {
      length += 1;
    }
  }
}

/**
 * Build a random string of the given length using {@link GENERATION_ALPHABET}.
 */
function randomString(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * GENERATION_ALPHABET.length);
    out += GENERATION_ALPHABET[index];
  }
  return out;
}
