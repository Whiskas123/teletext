/**
 * useFrozenPages — screens of playground pages a moderator has frozen, so
 * visitors can no longer change them. Set from `/manage`, one screen at a time;
 * the editor reads it through `canEditPage`. A page with frozen screens stays
 * open for new ones: visitors can still add a screen and draw on that.
 *
 * Keyed like the `pages` channel (`"745"`, `"745.2"`), so a frozen screen is
 * named by its number in the carousel. Known corner: /manage reordering or
 * removing screens does not carry the freeze along with the content.
 *
 * Kept in playhtml beside `page-kinds`, not in the database, because that is
 * where the page itself lives and so where the editor can see a freeze the
 * moment it is made. Known ceiling: like every playground rule this is enforced
 * in the browser (see docs/implementation-notes/2026-11-05-playground-safeguards.md),
 * so someone with devtools can still write to a frozen screen, or unfreeze it.
 * The version history and `db:restore --at` are the backstop; write rules in
 * a self-hosted playhtml server are the upgrade path.
 */

import { useCallback } from 'react';
import { usePageData } from '@playhtml/react';

import { MIN_SUBPAGE, pageKey } from '../domain/subpages';

/** Stable playhtml channel id: screen key to whether it is frozen. */
export const FROZEN_SCREENS_CHANNEL = 'frozen-screens';

type FrozenScreens = Record<string, boolean>;

export interface FrozenPagesApi {
  isFrozen(pageNumber: number, subpage?: number): boolean;
  /** Whether any of the page's first `count` screens is frozen. */
  hasFrozen(pageNumber: number, count: number): boolean;
  setFrozen(pageNumber: number, subpage: number, frozen: boolean): void;
}

export function useFrozenPages(): FrozenPagesApi {
  const [frozen, setFrozenScreens] = usePageData<FrozenScreens>(FROZEN_SCREENS_CHANNEL, {});

  const isFrozen = useCallback(
    (pageNumber: number, subpage: number = MIN_SUBPAGE) => frozen?.[pageKey(pageNumber, subpage)] === true,
    [frozen],
  );

  const hasFrozen = useCallback(
    (pageNumber: number, count: number) => {
      for (let subpage = MIN_SUBPAGE; subpage <= count; subpage += 1) {
        if (isFrozen(pageNumber, subpage)) return true;
      }
      return false;
    },
    [isFrozen],
  );

  const setFrozen = useCallback(
    (pageNumber: number, subpage: number, on: boolean) => {
      // `false` rather than removing the key: playhtml's draft cannot delete.
      setFrozenScreens((draft) => {
        draft[pageKey(pageNumber, subpage)] = on;
      });
    },
    [setFrozenScreens],
  );

  return { isFrozen, hasFrozen, setFrozen };
}
