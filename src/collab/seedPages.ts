/**
 * useSeedPages — one-time import of the shipped seed pages into the room store
 * (Requirement 7.1).
 *
 * Seeding is versioned: SEED_VERSION is stored in the shared `"seed-version"`
 * channel. If the stored version is less than SEED_VERSION, ALL seed pages and
 * titles are overwritten unconditionally (so new graphics land on existing
 * deployments). If the stored version already matches, seeding is skipped for
 * pages that have collaborative edits (non-clobbering). This lets us push
 * updated seed content to already-deployed instances.
 */

import { useEffect, useRef } from 'react';
import { usePageData } from '@playhtml/react';

import { isNonEmptyPage, normalizePage } from '../domain/pageOps';
import { SEED_PAGES, SEED_TITLES } from './seedData';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import type { PagesData, TitlesData } from './types';

/**
 * Increment this number whenever seed content changes in a way that should
 * overwrite existing deployed data (e.g. adding graphics to seed pages).
 * Pages that have received collaborative edits since the last seed run are
 * still clobbered intentionally — seed pages are demo content, not user work.
 */
const SEED_VERSION = 2;

/** Channel key that stores the last applied seed version number. */
const SEED_VERSION_CHANNEL = 'seed-version';

/**
 * Delay, in milliseconds, before the seed check runs, giving the room's shared
 * state a chance to sync so we don't seed a page a peer has already populated.
 */
const SEED_SETTLE_MS = 2000;

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
 * Perform the versioned seed import of the shipped pages into the room store.
 *
 * - If storedVersion < SEED_VERSION: overwrite ALL seed pages/titles so new
 *   graphics reach already-deployed instances.
 * - If storedVersion === SEED_VERSION: only seed pages that are absent/empty
 *   (non-clobbering, for brand-new deployments / fresh rooms).
 */
export function useSeedPages(): void {
  const [pages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [titles, setTitles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [storedVersion, setStoredVersion] = usePageData<number>(SEED_VERSION_CHANNEL, 0);

  const pagesRef = useRef<PagesData>(pages);
  pagesRef.current = pages;
  const titlesRef = useRef<TitlesData>(titles);
  titlesRef.current = titles;
  const versionRef = useRef<number>(storedVersion);
  versionRef.current = storedVersion;

  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;

    const timer = setTimeout(() => {
      if (seededRef.current) return;
      seededRef.current = true;

      const currentVersion = versionRef.current ?? 0;
      const forceOverwrite = currentVersion < SEED_VERSION;

      const current = pagesRef.current ?? {};

      // Determine which pages to write.
      const toSeed = Object.keys(SEED_PAGES)
        .map(Number)
        .filter((pageNumber) =>
          forceOverwrite ? true : isAbsentOrEmpty(current, pageNumber),
        );

      if (toSeed.length > 0) {
        setPages((draft) => {
          for (const pageNumber of toSeed) {
            // In non-force mode, re-check inside the mutator.
            if (!forceOverwrite && !isAbsentOrEmpty(draft, pageNumber)) continue;
            const seedMap = SEED_PAGES[pageNumber];
            // Reset the page slot entirely before writing seed cells.
            draft[pageNumber] = {};
            const target = draft[pageNumber]!;
            for (const [index, cell] of Object.entries(seedMap)) {
              target[Number(index)] = { ...cell };
            }
          }
        });
      }

      // Seed titles.
      const currentTitles = titlesRef.current ?? {};
      const toSeedTitles = Object.keys(SEED_TITLES)
        .map(Number)
        .filter((pageNumber) => {
          if (forceOverwrite) return true;
          const t = currentTitles[pageNumber];
          return typeof t !== 'string' || t.trim().length === 0;
        });

      if (toSeedTitles.length > 0) {
        setTitles((draft) => {
          for (const pageNumber of toSeedTitles) {
            if (!forceOverwrite) {
              const existing = draft[pageNumber];
              if (typeof existing === 'string' && existing.trim().length > 0) continue;
            }
            draft[pageNumber] = SEED_TITLES[pageNumber];
          }
        });
      }

      // Stamp the version so future page loads don't re-overwrite.
      if (forceOverwrite || currentVersion === 0) {
        setStoredVersion(SEED_VERSION);
      }
    }, SEED_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [setPages, setTitles, setStoredVersion]);
}
