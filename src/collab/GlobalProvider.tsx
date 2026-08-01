/**
 * GlobalProvider — mounts the app's single playhtml {@link PlayProvider}.
 *
 * Design notes (see design.md "Providers and shell"):
 * - The whole app shares ONE playhtml document, scoped by the fixed
 *   {@link GLOBAL_ROOM} namespace. Global content (`pages`, `titles`) and every
 *   room's coordination state live in this one document; room-specific channels
 *   are keyed by Room_ID (e.g. `chat:${roomId}`) rather than isolated by the
 *   provider namespace. This lets edits persist globally and show up in any room
 *   that watches the edited page.
 * - `pathname` (from react-router's `useLocation`) is forwarded so playhtml runs
 *   `handleNavigation()` when the user moves between routes. The provider must
 *   therefore be mounted inside `BrowserRouter`.
 * - Cursors are disabled: co-presence cursors are not needed anymore (editing is
 *   solo and watching is coordinated via chat / votes / the presence list).
 *
 * ## No seeding happens here any more
 *
 * This used to mount a `SeedPages` helper that wrote the compiled seed pages
 * into the `pages` channel on load, overwriting whatever was there whenever
 * `SEED_VERSION` was raised — collaborative edits included, by design. That was
 * the mechanism that made a redeploy able to destroy pages.
 *
 * Content now comes from the database: the seed pages were preserved into
 * `live_pages` by `scripts/importSeedPages.ts`, and what visitors see is
 * whatever has been published from `/manage`. Deploying changes nothing about
 * the live document.
 */

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PlayProvider } from '@playhtml/react';

/** Fixed playhtml namespace for the app's single shared document. */
export const GLOBAL_ROOM = 'teletext-house';

export interface GlobalProviderProps {
  children: ReactNode;
}

/**
 * Wrap the app in the single global playhtml provider.
 */
export function GlobalProvider({ children }: GlobalProviderProps) {
  const { pathname } = useLocation();

  return (
    <PlayProvider
      initOptions={{
        room: GLOBAL_ROOM,
        cursors: { enabled: false },
      }}
      pathname={pathname}
    >
      {children}
    </PlayProvider>
  );
}

export default GlobalProvider;
