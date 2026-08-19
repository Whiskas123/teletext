/**
 * useGuestbook — the playhtml binding for the book of signatures.
 *
 * A thin wrapper over `usePageData`, exactly as `useChat` is: every rule about
 * what a signature is and whether one is valid lives in `domain/guestbook.ts`,
 * and this only binds those rules to the shared document.
 *
 * The channel is **global**, not per room. There is one guestbook, and a
 * signature left while watching in the Kitchen is the same signature as one
 * left from the front page — so the id has no `:roomId` suffix, unlike chat,
 * presence and voting.
 */

import { useCallback, useMemo } from 'react';
import { usePageData } from '@playhtml/react';

import {
  readEntries,
  validateSignature,
  type GuestbookEntry,
  type SignatureValidation,
} from '../domain/guestbook';
import { getSessionMemberId } from './session';
import type { GuestbookData } from './types';
import type { TeletextPage } from '../types/teletext';

/** The one guestbook, for the whole site. */
export const GUESTBOOK_CHANNEL = 'guestbook';

/** What the channel holds before anyone has signed. */
const DEFAULT_GUESTBOOK_DATA: GuestbookData = { entries: [] };

/** Generate an entry id, preferring `crypto.randomUUID` where it exists. */
function newEntryId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface GuestbookApi {
  /** Every readable signature, newest first. */
  entries: GuestbookEntry[];
  /** This session's own id, so the page can mark the reader's own entries. */
  memberId: string;
  /**
   * Sign the book. Returns the validation result: `ok` when the signature was
   * appended, otherwise the reason it was refused and a book left unchanged.
   */
  sign(name: string, cells: TeletextPage): SignatureValidation;
}

export function useGuestbook(): GuestbookApi {
  const [data, setData] = usePageData<GuestbookData>(
    GUESTBOOK_CHANNEL,
    DEFAULT_GUESTBOOK_DATA,
  );

  // Repaired and ordered on the way out, not on the way in: what the document
  // holds was written by a client, and an entry that arrived malformed should
  // be skipped by every reader rather than trusted by the ones that reload
  // after it lands.
  const entries = useMemo(() => readEntries(data?.entries), [data?.entries]);

  const memberId = getSessionMemberId();

  const sign = useCallback(
    (name: string, cells: TeletextPage): SignatureValidation => {
      const validation = validateSignature(name, cells);
      if (!validation.ok) return validation;

      const entry: GuestbookEntry = {
        id: newEntryId(),
        name: validation.name,
        authorId: getSessionMemberId(),
        // Plain copies. What goes into the shared document must not be a
        // reference to state the form still owns and is about to clear.
        cells: cells.map((cell) => ({ ...cell })),
        ts: Date.now(),
      };

      // Push the one new entry rather than reassigning the array. Reassigning
      // would try to re-insert Yjs objects that are already integrated and
      // throw on the second signature — the same trap `useChat` documents.
      setData((draft) => {
        if (!Array.isArray(draft.entries)) draft.entries = [];
        draft.entries.push(entry);
      });

      return validation;
    },
    [setData],
  );

  return { entries, memberId, sign };
}

export default useGuestbook;
