/**
 * `usePageDataWithBoot` — `usePageData`, with the build's copy standing in
 * until playhtml has synced.
 *
 * Before the first sync `usePageData` returns its default: an empty map, so the
 * television is blank and every page looks unclaimed. This returns the channel
 * from `/boot/pages.json` instead (see `src/domain/bootData.ts`), and the live
 * channel from the first render after the sync.
 *
 * ## Only for hooks that read
 *
 * The setter is playhtml's own and still refuses to write before the sync, so
 * nothing can be written *from* the fallback directly. But a hook that computes
 * a write from what it read — the editor, publishing, the backup — must keep
 * using `usePageData`, or it could turn a stale picture into a live edit.
 *
 * ## When the switch happens
 *
 * Not on `isLoading` alone. `usePageData` fills its value in an effect *after*
 * `isLoading` flips, so for one render it still holds the empty default, and
 * switching then would flash a blank screen between the two copies. The switch
 * is also made in an effect, which React runs after `usePageData`'s and batches
 * with it — so the render that gives up the fallback is the one that has the
 * live data.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePageData, usePlayContext } from '@playhtml/react';

import {
  BOOT_DATA_PATH,
  BOOT_LIVE_PATH,
  parseBootData,
  type BootChannel,
  type BootData,
} from '../domain/bootData';

let boot: BootData | null = null;
let requested = false;
const listeners = new Set<() => void>();

/**
 * Start fetching the file, once per visit. Safe to call any number of times.
 *
 * A failure is silent on purpose: without the file the screen waits for
 * playhtml exactly as it did before the file existed.
 */
export function loadBootData(): void {
  if (requested || typeof fetch !== 'function') return;
  requested = true;

  const load = (path: string): Promise<BootData | null> =>
    fetch(path)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => parseBootData(json))
      .catch(() => null);

  // The database's copy first, being minutes old at most; the build's file if
  // that fails (a local dev server has no API, and it answers with HTML).
  void load(BOOT_LIVE_PATH)
    .then((live) => live ?? load(BOOT_DATA_PATH))
    .then((data) => {
      boot = data;
      if (boot != null) listeners.forEach((listener) => listener());
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getBoot = (): BootData | null => boot;
const getNoBoot = (): BootData | null => null;

type SetData<T> = ReturnType<typeof usePageData<T>>[1];

export function usePageDataWithBoot<T extends object>(
  channel: BootChannel,
  defaultValue: T,
): [T, SetData<T>] {
  const { isLoading } = usePlayContext();
  const [live, setLive] = usePageData<T>(channel, defaultValue);
  const booted = useSyncExternalStore(subscribe, getBoot, getNoBoot);

  const [synced, setSynced] = useState(!isLoading);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- in an effect on purpose, to land in the same render as `usePageData`'s own; see "When the switch happens" above
    if (!isLoading) setSynced(true);
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) loadBootData();
  }, [isLoading]);

  const fallback = booted?.[channel] as T | undefined;
  return [synced || fallback == null ? live : fallback, setLive];
}

/**
 * Whether the set has nothing to draw yet, for the static on the tube.
 *
 * True until the build's copy or the live document arrives, whichever is first.
 * Once there is a page it is shown clean, even while the live document is still
 * on its way — the "Tuning in…" banner says that much, and snow over a page that
 * is there to be read would only get in the way of reading it.
 */
export function useTuning(): boolean {
  const { isLoading } = usePlayContext();
  const booted = useSyncExternalStore(subscribe, getBoot, getNoBoot);

  useEffect(() => {
    if (isLoading) loadBootData();
  }, [isLoading]);

  return isLoading && booted == null;
}
