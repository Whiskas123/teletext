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
 *
 * ## Why there is a `localStorage` cache in front of it
 *
 * The book lives in the one shared playhtml document, and that document holds
 * everything else too — every page in the archive, every room's chat. Nothing
 * in it is readable until the whole thing has synced, which on a cold load is
 * long enough to notice. Before this, the page spent that time rendering "nobody
 * has signed yet", which is not "wait a moment" — it is a different, wrong
 * answer, and it was replaced by the real book a second later.
 *
 * So two things happen. A reader who has been here before gets the signatures
 * they saw last time painted immediately, from `localStorage`, while the
 * document syncs behind them; a reader who has not gets {@link GuestbookApi.loading}
 * and can be told to wait. Either way nobody is told the book is empty when it
 * is not. The shared document is the source of truth and replaces the cache the
 * moment it arrives — the cache is only ever a head start.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePageData, usePlayContext } from '@playhtml/react';

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

/** Where the head start is kept. */
const CACHE_KEY = 'teletext.guestbook.entries';

/**
 * How many signatures the cache holds.
 *
 * A snippet is 320 cells and each one serializes to a small object, so an entry
 * costs on the order of ten kilobytes of JSON. The cache exists to fill the
 * first screen, not to be a second copy of the book, and the newest few are
 * what a first screen shows — so it keeps those and lets the shared document
 * supply the rest of the scroll.
 */
const CACHE_LIMIT = 8;

/** The cached book, repaired on the way out like any other stored entry. */
function readCache(): GuestbookEntry[] {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored == null ? [] : readEntries(JSON.parse(stored));
  } catch {
    // No storage, or a cache written by something else. No head start, no harm.
    return [];
  }
}

function writeCache(entries: readonly GuestbookEntry[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(0, CACHE_LIMIT)));
  } catch {
    // Private browsing, or a full quota. Costs this reader a head start next
    // time and nothing else; not worth interrupting for.
  }
}

/** Generate an entry id, preferring `crypto.randomUUID` where it exists. */
function newEntryId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface GuestbookApi {
  /**
   * Every readable signature, newest first.
   *
   * While the shared document is still syncing this is the cached book, if
   * there is one — so a returning reader sees signatures straight away rather
   * than a blank column.
   */
  entries: GuestbookEntry[];
  /**
   * Whether the book has not arrived yet *and* there is nothing to show in the
   * meantime. False as soon as there is something to read, cached or synced, so
   * a spinner never sits over signatures that are already on the screen.
   */
  loading: boolean;
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

  // `isLoading` is playhtml's own "not synced yet", and `isProviderMissing` is
  // "cannot sync at all" — the same two signals `useConnection` derives from.
  // Until one of them clears, an empty `entries` means "not here yet", not
  // "empty".
  const { isLoading, isProviderMissing } = usePlayContext();
  const syncing = isProviderMissing || isLoading;

  // Repaired and ordered on the way out, not on the way in: what the document
  // holds was written by a client, and an entry that arrived malformed should
  // be skipped by every reader rather than trusted by the ones that reload
  // after it lands.
  const synced = useMemo(() => readEntries(data?.entries), [data?.entries]);

  // Read once, on mount. The cache is a snapshot to paint while waiting, not a
  // store that changes under us.
  const cached = useMemo(() => readCache(), []);

  // The synced book wins the moment it has anything in it, and outright once
  // syncing is done — including when what it has is genuinely nothing, so a
  // guestbook someone has cleared does not keep showing a stale cache.
  const entries = syncing && synced.length === 0 ? cached : synced;

  /*
   * Refresh the cache once there is a synced book to cache.
   *
   * Keyed on a cheap signature of what is in it rather than on the array, which
   * is rebuilt on every render that touches the document: without this, every
   * keystroke elsewhere on the page would re-serialize eight snippets.
   */
  const cachedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (syncing) return;
    const signature = synced
      .slice(0, CACHE_LIMIT)
      .map((entry) => `${entry.id}:${entry.ts}`)
      .join(',');
    if (signature === cachedSignature.current) return;
    cachedSignature.current = signature;
    writeCache(synced);
  }, [syncing, synced]);

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

  return { entries, loading: syncing && entries.length === 0, memberId, sign };
}

export default useGuestbook;
