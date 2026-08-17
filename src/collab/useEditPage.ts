/**
 * useEditPage — playhtml binding for SOLO editing of a GLOBAL teletext page
 * (Requirements 6 and 7).
 *
 * Teletext pages are global shared content: anyone can edit a page on its own,
 * in a dedicated clutter-free editor, and the edit persists globally so it shows
 * up wherever the page is watched. This hook binds that editing to the single
 * global `"pages"` channel; the decision logic (cell validation) delegates to
 * the pure, framework-free `src/domain/cellEdit.ts` and `src/domain/pageOps.ts`
 * modules so the behavior is unit- and property-testable without a live Yjs
 * connection.
 *
 * ## Critical design choice: page stored as a cell-indexed map
 *
 * Pages are persisted in the shared `"pages"` channel as
 * {@link PagesData} = `Record<pageNumber, PageCellMap>`, where a
 * {@link PageCellMap} is `Record<cellIndex 0..959, Cell>`. `editCell` writes
 * **only the single changed cell key** through an immer-style mutator:
 *
 * ```ts
 * setPages((draft) => {
 *   (draft[pageNumber] ??= {})[index] = cell; // one key written
 * });
 * ```
 *
 * Because the store is Yjs-backed, concurrent edits to **different** cells write
 * **different** keys → both survive the merge (Req 6.2); edits to the **same**
 * cell write the **same** key → Yjs resolves last-writer-wins and every replica
 * converges (Req 6.3, 8.5). The positional 960-cell {@link TeletextPage} the UI
 * renders is reconstructed by {@link normalizePage} (missing keys → empty
 * cells), always yielding exactly 960 valid cells (Req 6.4, 7.7).
 *
 * Editing is solo — there is no chat, voting, presence or cursor layer here.
 *
 * Requirements covered: 6.1, 6.2, 6.3, 6.4, 6.7, 7.2, 7.3, 7.4, 7.7, 7.8, 7.9.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { isValidCell } from '../domain/cellEdit';
import { unsettledEdits, withLocalEdits, type LocalEdits } from '../domain/localEdits';
import { normalizePage } from '../domain/pageOps';
import { reuseUnchangedCells } from '../domain/pageReuse';
import { MIN_SUBPAGE, pageKey } from '../domain/subpages';
import {
  TOTAL_CELLS,
  type Cell,
  type PagesData,
  type TeletextPage,
} from './types';

/** Stable playhtml channel id for the GLOBAL map of page content. */
export const PAGES_CHANNEL = 'pages';

/**
 * How long edits are allowed to accumulate before they are written to the
 * shared store.
 *
 * Short enough that a collaborator watching the page sees a stroke arrive as it
 * is drawn rather than after it, and that a member who types and immediately
 * closes the tab has been persisted; long enough that the store's per-write
 * cost — a deep clone of every page in the workshop, see {@link editCell} — is
 * paid a handful of times a second instead of once per pointer sample.
 */
const FLUSH_INTERVAL_MS = 150;

/**
 * Result of an {@link EditPageApi.editCell} request.
 *
 * `'ok'` when the edit was valid and written to the shared page; `'invalid'`
 * when the cell is malformed or the index is out of range, in which case the
 * cell retains its current value (Req 6.7).
 */
export type EditCellResult = 'ok' | 'invalid';

/**
 * Public editing API surface.
 */
export interface EditPageApi {
  /** Normalized 960-cell page for the edited Page_Number (Req 6.4, 7.4, 7.7). */
  page: TeletextPage;
  /**
   * Apply a single cell edit. Returns `'ok'` when the cell is valid and the
   * index is in `0..959` (the change is persisted to the shared page), or
   * `'invalid'` otherwise (a no-op that retains the cell's value; Req 6.1, 6.7).
   */
  editCell(index: number, cell: Cell): EditCellResult;
  /**
   * Non-null with an error indication when the last persist attempt failed;
   * the member's in-editor edits are retained regardless (Req 7.9). `null`
   * while writes are succeeding.
   */
  saveError: string | null;
}

/** Whether `index` is a valid cell index: an integer in `0..959`. */
function isCellIndexInRange(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
}

/**
 * Bind solo editing of a single GLOBAL Page_Number to playhtml.
 *
 * @param pageNumber the Page_Number being edited (assumed a valid 1..999 page).
 * @param subpage which screen of that page's carousel, defaulting to the first.
 *   Only the key changes: a subpage is a whole page in its own right, so every
 *   merge guarantee above holds per subpage rather than per page number (see
 *   `domain/subpages.ts`).
 */
export function useEditPage(
  pageNumber: number,
  subpage: number = MIN_SUBPAGE,
): EditPageApi {
  const [pages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});

  const [saveError, setSaveError] = useState<string | null>(null);

  const key = pageKey(pageNumber, subpage) as number;

  /**
   * This page's stored cells, pulled out before the memo.
   *
   * The `pages` channel is the whole document, so its identity changes when
   * *anyone* edits *any* page. Keying the memo on `pages` therefore rebuilt all
   * 960 cells whenever someone typed on a different page entirely. Keying it on
   * this page's own entry means an edit elsewhere costs a render that reuses the
   * page it already had.
   */
  const stored = pages ? pages[key] : undefined;

  /**
   * The page as last handed out, so unchanged cells keep their identity.
   *
   * `normalizePage` builds 960 fresh objects every time it runs, which makes
   * every cell a changed prop and every keystroke a 960-cell re-render. Holding
   * the previous result and reusing the cells that are equal to it is what lets
   * the grid re-render only the cells a stroke actually touched — see
   * `domain/pageReuse.ts`.
   *
   * A ref rather than state: it is a cache of what was already returned, not a
   * value anything should re-render to see.
   */
  const previousPageRef = useRef<TeletextPage | null>(null);

  /**
   * Edits made here that the store has not confirmed yet (`domain/localEdits.ts`).
   *
   * The editor renders these on top of the stored page, so an edit is on screen
   * in the same frame it was made rather than after a round trip through Yjs —
   * a round trip whose cost is a deep clone of every page in the workshop, and
   * so grows with the workshop rather than with the edit.
   */
  const localRef = useRef<LocalEdits>(new Map());
  /** Bumped on each local edit so the page below is rebuilt to show it. */
  const [localVersion, setLocalVersion] = useState(0);

  // Normalize the stored cell-indexed map (or absent entry) into a valid
  // 960-cell page for rendering (Req 6.4, 7.4, 7.7).
  const page = useMemo<TeletextPage>(() => {
    /*
     * Reading and writing a ref while rendering, which `react-hooks/refs`
     * forbids and which is *safe here specifically*.
     *
     * The rule guards against a render being discarded — under concurrent
     * rendering React may throw one away — leaving a ref holding something that
     * was never shown. That is a bug when correctness depends on the ref's
     * contents. It does not here: the cache is only ever consulted through a
     * *value* comparison, so the worst a discarded render can do is offer cells
     * from a page nobody saw, and a cell equal in every field to the one being
     * rendered is indistinguishable from it. The page produced is identical
     * either way; only the identity-sharing, which is an optimisation, varies.
     *
     * The sanctioned alternative — deriving the cache with `useState` and
     * setting it during render — costs a second pass through this hook on every
     * keystroke, in the exact path being optimised.
     *
     * `localRef` is read here for the same reason and is safe for a stronger
     * one: dropping a settled edit is idempotent, so a discarded render that
     * loses the pruning simply prunes again on the next one.
     */
    const storedPage = normalizePage(stored);
    // Local edits the store has caught up with are dropped here, which is the
    // only place that can know: it is the one place the two are both in hand.
    const local = unsettledEdits(storedPage, localRef.current);
    localRef.current = local;
    const previous = previousPageRef.current;
    const normalized = reuseUnchangedCells(withLocalEdits(storedPage, local), previous);
    previousPageRef.current = normalized;
    return normalized;
    // `localVersion` is the dependency that matters and the one the rule cannot
    // see: the local edits live in a ref, so bumping the counter is what tells
    // this memo an edit was made. Removing it would leave the editor showing
    // only what the store had last said, which is the round trip being avoided.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, localVersion]);

  // A different page shares nothing with the last one; keeping its cells would
  // only make the comparison do work that cannot succeed. Its unconfirmed edits
  // belong to it too — they are flushed by the effect below before this runs.
  useEffect(() => {
    previousPageRef.current = null;
    localRef.current = new Map();
  }, [key]);

  /** Which page the outstanding local edits belong to. */
  const localKeyRef = useRef(key);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writePending = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const cells = localRef.current;
    const pending = { key: localKeyRef.current, cells };
    if (cells.size === 0) return;

    try {
      // Still one key per cell, so the merge guarantees above are untouched:
      // concurrent edits to different cells write different keys and both
      // survive, same-cell edits converge last-writer-wins. What changed is
      // only how many of those keys are written per transaction.
      setPages((draft) => {
        let cellMap = draft[pending.key];
        if (cellMap == null) {
          cellMap = {};
          draft[pending.key] = cellMap;
        }
        for (const [index, cell] of pending.cells) {
          cellMap[index] = { ...cell };
        }
      });
      // Clear any prior save error on a successful write (Req 7.9).
      setSaveError(null);
    } catch (error) {
      // Best-effort persistence: keep the member's edits and surface an
      // error indication without throwing (Req 7.9).
      setSaveError(error instanceof Error ? error.message : 'Change not saved');
    }
  }, [setPages]);

  const editCell = useCallback(
    (index: number, cell: Cell): EditCellResult => {
      // Reject malformed cells and out-of-range indices as a no-op (Req 6.7).
      if (!isCellIndexInRange(index) || !isValidCell(cell)) {
        return 'invalid';
      }

      // Edits waiting for a different page belong to that page: write them
      // where they were made before starting a batch for this one.
      if (localKeyRef.current !== key) {
        writePending();
        localRef.current = new Map();
        localKeyRef.current = key;
      }

      localRef.current.set(index, cell);
      // The page is rebuilt from this, so the edit is on screen on the next
      // render — it does not wait to be told about by the store. Bumping a
      // counter rather than holding the edits in state: clearing a page is 960
      // of these in a loop, and 960 new maps for it would be quadratic.
      setLocalVersion((version) => version + 1);

      /*
       * Written to the store on a timer, not on the microtask after every edit.
       *
       * The painters no longer need it to be immediate: they read the page,
       * and the page now carries the local edits already (`localRef`), so a
       * pixel brush changing one sixth still sees the other five it just
       * painted. That was the only thing the microtask was buying.
       *
       * What it cost was severe. Every write hands the store's subscribers a
       * `structuredClone` of the whole `pages` channel — every page in the
       * workshop, not just this one — so a stroke that samples the pointer a
       * hundred times a second asked for a hundred deep copies of the entire
       * document a second. Batching them into one write per
       * {@link FLUSH_INTERVAL_MS} leaves the merge semantics untouched (the
       * same cells, the same keys, last-writer-wins per cell) and takes that
       * off the drawing path.
       */
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          writePending();
        }, FLUSH_INTERVAL_MS);
      }

      return 'ok';
    },
    [key, writePending],
  );

  // Nothing in hand when the editor goes away, or when it moves to another
  // page: an unflushed stroke would simply be lost.
  useEffect(() => writePending, [writePending, key]);

  /*
   * Nothing in hand when the tab goes away either.
   *
   * Deferring the write by {@link FLUSH_INTERVAL_MS} opens a window in which
   * closing the tab, or switching away from it on a phone — where the system
   * may discard the page without ever running an unload handler — would lose
   * the last edits. `pagehide` and a hidden `visibilitychange` are the two
   * events that survive that, so both flush.
   */
  useEffect(() => {
    const flush = () => writePending();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') writePending();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [writePending]);

  return { page, editCell, saveError };
}
