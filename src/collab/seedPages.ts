/**
 * useSeedPages — one-time import of the shipped seed pages into the room store
 * (Requirement 7.1).
 *
 * The pre-playhtml app shipped two canonical pages as positional 960-cell files
 * in `.teletext-pages/` (pages 100 and 200). This hook migrates that content
 * into the Playhtml_Store the first time a room is opened that has no stored
 * content for those Page_Numbers yet, so the pages remain available after the
 * persistence layer moved to playhtml. The seed content lives in
 * `./seedData.ts` (generated from the JSON) already in the cell-index map form
 * the shared `"pages"` channel persists ({@link PageCellMap}).
 *
 * ## Non-clobbering guarantee
 *
 * Seeding must never overwrite collaborative edits. The hook only writes a seed
 * page key that is currently **absent or empty** in the store — a Page_Number
 * whose stored content is missing, or normalizes to an empty page (no cell
 * differs from the default). A page that already holds any content is left
 * untouched. Writes go through the same per-cell immer mutator {@link useEditPage}
 * uses, setting only the seed page's cell keys.
 *
 * Because playhtml/Yjs surfaces the channel default (`{}`) before the room has
 * finished syncing, the hook waits a short settling delay after mount before it
 * inspects the store, so it does not seed a page that a peer has already
 * populated. The write runs at most once per mount, guarded by a ref.
 *
 * ## Wiring
 *
 * `useSeedPages` must run inside a `PlayProvider` (it uses `usePageData`). It is
 * mounted ONCE by {@link GlobalProvider} at the app root via a tiny render-null
 * `SeedPages` component, so the global `pages` channel is seeded a single time
 * regardless of which screen mounts first.
 *
 * Requirements: 7.1.
 */

import { useEffect, useRef } from 'react';
import { usePageData } from '@playhtml/react';

import { isNonEmptyPage, normalizePage } from '../domain/pageOps';
import { SEED_PAGES, SEED_TITLES } from './seedData';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import type { PagesData, TitlesData } from './types';

/**
 * Delay, in milliseconds, before the seed check runs, giving the room's shared
 * state a chance to sync so we don't seed a page a peer has already populated.
 */
const SEED_SETTLE_MS = 1500;

/**
 * Whether the store currently has no usable content for `pageNumber`: the key
 * is absent, or its stored value normalizes to an empty page.
 */
function isAbsentOrEmpty(pages: PagesData, pageNumber: number): boolean {
  const stored = pages ? pages[pageNumber] : undefined;
  if (stored == null) return true;
  return !isNonEmptyPage(normalizePage(stored));
}

/**
 * Perform the one-time seed import of the shipped pages into the room store.
 *
 * Runs once after the store has had a chance to sync, writing each seed page
 * only when its Page_Number is absent or empty in the store (Req 7.1). Returns
 * nothing; it is a side-effecting hook.
 */
export function useSeedPages(): void {
  const [pages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [titles, setTitles] = usePageData<TitlesData>(TITLES_CHANNEL, {});

  // Keep live references to the latest store snapshots so the delayed check
  // reads current state without re-arming the timer on every store change.
  const pagesRef = useRef<PagesData>(pages);
  pagesRef.current = pages;
  const titlesRef = useRef<TitlesData>(titles);
  titlesRef.current = titles;

  // Guard: seed at most once per mount.
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;

    const timer = setTimeout(() => {
      if (seededRef.current) return;
      seededRef.current = true;

      // --- Seed page content (only where absent/empty) ---
      const current = pagesRef.current ?? {};
      const missing = Object.keys(SEED_PAGES)
        .map(Number)
        .filter((pageNumber) => isAbsentOrEmpty(current, pageNumber));

      if (missing.length > 0) {
        setPages((draft) => {
          for (const pageNumber of missing) {
            // Re-check inside the mutator against the freshest draft so a page
            // populated between the snapshot and the write is not clobbered.
            if (!isAbsentOrEmpty(draft, pageNumber)) continue;
            const seedMap = SEED_PAGES[pageNumber];
            const target = (draft[pageNumber] ??= {});
            for (const [index, cell] of Object.entries(seedMap)) {
              target[Number(index)] = { ...cell };
            }
          }
        });
      }

      // --- Seed titles (only where none is set) ---
      const currentTitles = titlesRef.current ?? {};
      const missingTitles = Object.keys(SEED_TITLES)
        .map(Number)
        .filter((pageNumber) => {
          const t = currentTitles[pageNumber];
          return typeof t !== 'string' || t.trim().length === 0;
        });

      if (missingTitles.length > 0) {
        setTitles((draft) => {
          for (const pageNumber of missingTitles) {
            const existing = draft[pageNumber];
            if (typeof existing === 'string' && existing.trim().length > 0) {
              continue;
            }
            draft[pageNumber] = SEED_TITLES[pageNumber];
          }
        });
      }
    }, SEED_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [setPages, setTitles]);
}
