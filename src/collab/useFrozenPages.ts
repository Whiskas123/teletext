/**
 * useFrozenPages — playground pages a moderator has frozen, so visitors can no
 * longer change them. Set from `/manage`; the editor reads it through
 * `canEditPage` and treats a frozen page like a reserved archive one.
 *
 * Kept in playhtml beside `page-kinds`, not in the database, because that is
 * where the page itself lives and so where the editor can see a freeze the
 * moment it is made. Known ceiling: like every playground rule this is enforced
 * in the browser (see docs/implementation-notes/2026-11-05-playground-safeguards.md),
 * so someone with devtools can still write to a frozen page, or unfreeze it.
 * The version history and `db:restore --at` are the backstop; write rules in
 * a self-hosted playhtml server are the upgrade path.
 */

import { useCallback } from 'react';
import { usePageData } from '@playhtml/react';

/** Stable playhtml channel id: page number to whether it is frozen. */
export const FROZEN_PAGES_CHANNEL = 'frozen-pages';

type FrozenPages = Record<string, boolean>;

export interface FrozenPagesApi {
  isFrozen(pageNumber: number): boolean;
  setFrozen(pageNumber: number, frozen: boolean): void;
}

export function useFrozenPages(): FrozenPagesApi {
  const [frozen, setFrozenPages] = usePageData<FrozenPages>(FROZEN_PAGES_CHANNEL, {});

  const isFrozen = useCallback((pageNumber: number) => frozen?.[pageNumber] === true, [frozen]);

  const setFrozen = useCallback(
    (pageNumber: number, on: boolean) => {
      // `false` rather than removing the key: playhtml's draft cannot delete.
      setFrozenPages((draft) => {
        draft[pageNumber] = on;
      });
    },
    [setFrozenPages],
  );

  return { isFrozen, setFrozen };
}
