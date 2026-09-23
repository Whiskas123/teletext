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
  fetch(BOOT_DATA_PATH)
    .then((response) => (response.ok ? response.json() : null))
    .then((json: unknown) => {
      boot = parseBootData(json);
      if (boot != null) listeners.forEach((listener) => listener());
    })
    .catch(() => {});
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
