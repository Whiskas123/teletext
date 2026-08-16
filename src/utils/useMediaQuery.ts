/**
 * Whether a media query matches, kept in step as it changes.
 *
 * `useSyncExternalStore` rather than state plus an effect. A media query *is* an
 * external store, and this is what the hook is for: the value is read during
 * render, so it is never a frame stale, and there is no `setState` in an effect
 * body to cascade a second render out of. The subscribe-then-read dance the
 * effect version needed — to catch a change between rendering and subscribing —
 * disappears, because there is no window to miss.
 *
 * Every access is wrapped: `matchMedia` is absent in jsdom and throws outright
 * in a few embedded browsers, and no layout decision is worth a blank screen.
 * Where it cannot be answered the result is `false`, which for every caller here
 * means the roomy layout — the one that degrades most gracefully.
 */

import { useCallback, useSyncExternalStore } from 'react';

function matchMediaSafely(query: string): MediaQueryList | undefined {
  try {
    return globalThis.matchMedia?.(query);
  } catch {
    return undefined;
  }
}

/** Server and jsdom have no viewport to measure; assume the roomy layout. */
function serverSnapshot(): boolean {
  return false;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = matchMediaSafely(query);
      list?.addEventListener('change', onStoreChange);
      return () => list?.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => matchMediaSafely(query)?.matches ?? false,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
