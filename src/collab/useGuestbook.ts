/**
 * useGuestbook — the book of signatures, read from and written to
 * `/api/guestbook`.
 *
 * Every rule about what a signature is and whether one is valid lives in
 * `domain/guestbook.ts`; the server applies the same rules again. One book for
 * the whole site.
 *
 * ## Why not playhtml any more
 *
 * The book lived in the one shared playhtml document, with everything else. In
 * October 2026 that document grew too large for playhtml's server to open, and
 * every signature in it became unreachable — and while it lasted, nothing in
 * it was readable until the whole document had synced. A signature is written
 * once and never edited, so it needs none of what playhtml offers; in the
 * database it is backed up, and the page asks for exactly the book.
 *
 * New signatures reach other readers on the next refresh, every
 * {@link REFRESH_MS} while the page is visible.
 *
 * ## Why there is a `localStorage` cache in front of it
 *
 * A reader who has been here before gets the signatures they saw last time
 * painted immediately while the book loads; a reader who has not gets
 * {@link GuestbookApi.loading} and can be told to wait. Either way nobody is
 * told the book is empty when it is not. The server's book replaces the cache
 * the moment it arrives — the cache is only ever a head start, and never
 * overwritten by an empty book (it was, for a while, the only copy left of the
 * signatures stranded in playhtml).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  normalizeEntry,
  readEntries,
  sortEntries,
  validateSignature,
  type GuestbookEntry,
  type SignatureValidation,
} from '../domain/guestbook';
import { getSessionMemberId } from './session';
import { STALL_MS } from './useConnection';
import type { TeletextPage } from '../types/teletext';

/** Where the book is read and signed. */
export const GUESTBOOK_PATH = '/api/guestbook';

/** How often an open page asks for new signatures. */
const REFRESH_MS = 30_000;

/**
 * What signing returns: the book's own verdict; `offline` when the server
 * could not be reached or did not take it; `too-soon` when the same reader
 * signed moments ago.
 */
export type SignResult = SignatureValidation | { ok: false; reason: 'offline' | 'too-soon' };

/** Where the head start is kept. */
const CACHE_KEY = 'teletext.guestbook.entries';

/**
 * How many signatures the cache holds.
 *
 * A snippet is 320 cells and each one serializes to a small object, so an entry
 * costs on the order of ten kilobytes of JSON. The cache exists to fill the
 * first screen, not to be a second copy of the book, and the newest few are
 * what a first screen shows — so it keeps those and lets the server supply the
 * rest of the scroll.
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

export interface GuestbookApi {
  /**
   * Every readable signature, newest first.
   *
   * Until the book has loaded this is the cached book, if there is one — so a
   * returning reader sees signatures straight away rather than a blank column.
   */
  entries: GuestbookEntry[];
  /**
   * Whether the book has not arrived yet *and* there is nothing to show in the
   * meantime. False as soon as there is something to read, cached or loaded,
   * so a spinner never sits over signatures that are already on the screen.
   */
  loading: boolean;
  /**
   * Whether the book has failed to load, or taken longer than
   * {@link STALL_MS}. The page says so instead of showing a skeleton that will
   * not resolve — and, over cached signatures, that they may be out of date.
   */
  unreachable: boolean;
  /** This session's own id, so the page can mark the reader's own entries. */
  memberId: string;
  /**
   * Sign the book. Resolves with the validation result: `ok` once the server
   * has stored the signature, otherwise why it was not.
   */
  sign(name: string, cells: TeletextPage): Promise<SignResult>;
}

export function useGuestbook(): GuestbookApi {
  // Read once, on mount. The cache is a snapshot to paint while waiting, not a
  // store that changes under us.
  const cached = useMemo(() => readCache(), []);
  /** The server's book; null until it has answered once. */
  const [book, setBook] = useState<GuestbookEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(GUESTBOOK_PATH, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`guestbook ${response.status}`);
      const body = (await response.json()) as { entries?: unknown };
      // Repaired on the way in, like anything stored: an entry that cannot be
      // read is skipped rather than drawn as an empty band.
      setBook(readEntries(body.entries));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const stall = setTimeout(() => setTimedOut(true), STALL_MS);
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      clearTimeout(stall);
      clearInterval(refresh);
    };
  }, [load]);

  const waiting = book == null;
  const entries = book ?? cached;

  /*
   * Refresh the cache once there is a book to cache.
   *
   * Keyed on a cheap signature of what is in it rather than on the array, so
   * a refresh that brings nothing new does not re-serialize eight snippets.
   */
  const cachedSignature = useRef<string | null>(null);
  useEffect(() => {
    // An empty book never replaces a cache that has signatures in it.
    if (book == null || book.length === 0) return;
    const signature = book
      .slice(0, CACHE_LIMIT)
      .map((entry) => `${entry.id}:${entry.ts}`)
      .join(',');
    if (signature === cachedSignature.current) return;
    cachedSignature.current = signature;
    writeCache(book);
  }, [book]);

  const memberId = getSessionMemberId();

  const sign = useCallback(
    async (name: string, cells: TeletextPage): Promise<SignResult> => {
      const validation = validateSignature(name, cells);
      if (!validation.ok) return validation;

      try {
        const response = await fetch(GUESTBOOK_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: validation.name, cells, authorId: getSessionMemberId() }),
        });
        if (response.status === 429) return { ok: false, reason: 'too-soon' };
        if (!response.ok) return { ok: false, reason: 'offline' };
        const stored = normalizeEntry(((await response.json()) as { entry?: unknown }).entry);
        // On the page at once, without waiting for the next refresh.
        if (stored != null) {
          setBook((current) =>
            sortEntries([stored, ...(current ?? cached).filter((entry) => entry.id !== stored.id)]),
          );
        }
        return validation;
      } catch {
        return { ok: false, reason: 'offline' };
      }
    },
    [cached],
  );

  return {
    entries,
    loading: waiting && entries.length === 0,
    unreachable: waiting && (failed || timedOut),
    memberId,
    sign,
  };
}

export default useGuestbook;
