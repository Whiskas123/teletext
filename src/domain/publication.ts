/**
 * What may be published, where, and with what label.
 *
 * Publishing takes one capture out of the corpus and puts it on a Page_Number
 * that visitors can dial. The rules are small but load-bearing, and they are
 * here — pure and framework-free — rather than inside a route handler, so they
 * can be tested directly and so the admin UI and the API agree by construction
 * instead of by coincidence.
 *
 * Three constraints, each for a different reason:
 *
 * - **The target must be an archive page (100..699).** 700..999 is the open
 *   playground, where anyone may edit; publishing curated content there would
 *   put it somewhere it can be overwritten by any visitor. See `access.ts`.
 * - **The capture must have been decoded.** A capture with no cells is
 *   catalogued but not renderable — the whole SIC corpus is in this state. It
 *   can be browsed and chosen, but publishing it would put a blank page on air.
 * - **Title and description are bounded.** The title shares
 *   {@link MAX_TITLE_LENGTH} with the collaborative TV Guide, since it *is* that
 *   title: publishing writes it to the same `titles` channel.
 */

import { isArchivePage } from './access';
import { toInteger } from './coerce';
import { MAX_TITLE_LENGTH, validateTitle } from './titles';

/** Longest description accepted for a published page. */
export const MAX_DESCRIPTION_LENGTH = 500;

export { MAX_TITLE_LENGTH };

/** Why a publication request was refused. */
export type PublicationRejection =
  | 'page-out-of-range'
  | 'capture-missing'
  | 'capture-not-decoded'
  | 'title-too-long'
  | 'description-too-long';

/** A validated publication, with its text already trimmed. */
export interface Publication {
  pageNumber: number;
  captureId: number;
  title: string;
  description: string;
}

export type ValidatePublicationResult =
  | { ok: true; value: Publication }
  | { ok: false; reason: PublicationRejection };

/** Human-readable explanation of a rejection, for the admin UI. */
export function describeRejection(reason: PublicationRejection): string {
  switch (reason) {
    case 'page-out-of-range':
      return 'Page number must be between 100 and 699 — 700 and above is the open playground.';
    case 'capture-missing':
      return 'That capture is not in the archive.';
    case 'capture-not-decoded':
      return 'That capture has not been decoded yet, so there is nothing to show.';
    case 'title-too-long':
      return `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
    case 'description-too-long':
      return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  }
}

/** Whether `pageNumber` is a slot the archive may be published to. */
export function isPublishablePage(pageNumber: unknown): boolean {
  return typeof pageNumber === 'number' && isArchivePage(pageNumber);
}

/**
 * Validate a publication request.
 *
 * `captureDecoded` is passed in rather than looked up: this module stays pure,
 * and the caller has already had to fetch the capture to know it exists.
 */
export function validatePublication(
  input: Readonly<Record<string, unknown>>,
  capture: { exists: boolean; decoded: boolean },
): ValidatePublicationResult {
  const pageNumber = toInteger(input.pageNumber);
  if (pageNumber == null || !isPublishablePage(pageNumber)) {
    return { ok: false, reason: 'page-out-of-range' };
  }

  const captureId = toInteger(input.captureId);
  if (captureId == null || captureId <= 0 || !capture.exists) {
    return { ok: false, reason: 'capture-missing' };
  }
  if (!capture.decoded) {
    return { ok: false, reason: 'capture-not-decoded' };
  }

  const title = validateTitle(typeof input.title === 'string' ? input.title : '');
  if (!title.ok) {
    return { ok: false, reason: 'title-too-long' };
  }

  const rawDescription =
    typeof input.description === 'string' ? input.description.trim() : '';
  if (rawDescription.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, reason: 'description-too-long' };
  }

  return {
    ok: true,
    value: {
      pageNumber,
      captureId,
      title: title.value,
      description: rawDescription,
    },
  };
}
