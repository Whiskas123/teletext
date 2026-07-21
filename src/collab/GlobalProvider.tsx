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
 * - The one-time seed import ({@link useSeedPages}) runs here, once, so the
 *   global `pages` channel is seeded regardless of which screen mounts first.
 */

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PlayProvider } from '@playhtml/react';

import { useSeedPages } from './seedPages';

/** Fixed playhtml namespace for the app's single shared document. */
export const GLOBAL_ROOM = 'teletext-house';

/**
 * Render-null helper that runs the one-time seed import (Req 7.1) inside the
 * `PlayProvider` so the global `pages` channel is seeded exactly once.
 */
function SeedPages() {
  useSeedPages();
  return null;
}

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
      <SeedPages />
      {children}
    </PlayProvider>
  );
}

export default GlobalProvider;
