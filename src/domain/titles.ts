/**
 * Page_Title domain logic for Collaborative Teletext Rooms.
 *
 * A Page_Title is a human-readable label associated with a Page_Number,
 * containing 0 to 60 characters after trimming leading and trailing whitespace.
 * A Page_Title of length 0 denotes a page with no title. This module is pure and
 * framework-free (no React, no playhtml) so it can be exhaustively
 * property-tested without a live server.
 *
 * _Requirements: 9.2, 9.4, 9.6_
 */

import type { TitlesData } from '../collab/types';

/** Maximum length of a Page_Title after trimming (Req 9.4, 9.6). */
export const MAX_TITLE_LENGTH = 60;

/**
 * The result of validating a candidate Page_Title.
 *
 * On success, `value` is the trimmed text (a whitespace-only or empty input
 * yields a length-0 title). On failure, `reason` explains why the title was
 * rejected.
 */
export type ValidateTitleResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'too-long' };

/**
 * Validate a candidate Page_Title.
 *
 * Accepts iff the trimmed length is between 0 and {@link MAX_TITLE_LENGTH}
 * inclusive, returning the trimmed text as `value` (an empty or whitespace-only
 * input trims to a length-0 title). When the trimmed length exceeds
 * {@link MAX_TITLE_LENGTH}, the title is rejected with reason `'too-long'` and
 * the caller retains the current title. Total: never throws for any string
 * input.
 *
 * _Requirements: 9.2, 9.4, 9.6_
 */
export function validateTitle(raw: string): ValidateTitleResult {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Read the stored Page_Title for a Page_Number, defaulting to a length-0 title.
 *
 * A Page_Number with no stored title reads as a length-0 title (the empty
 * string), matching the rule that an absent key denotes a Page_Title of length
 * 0. Total: never throws for missing keys or an absent/undefined `titles` map.
 *
 * _Requirements: 9.2_
 */
export function readTitle(
  titles: TitlesData | undefined,
  pageNumber: number,
): string {
  const stored = titles?.[pageNumber];
  return typeof stored === 'string' ? stored : '';
}
