/**
 * useRoomOccupancy — read-only snapshot of how many members are present in
 * each of the given room IDs, for display on the landing page.
 *
 * Reads the `presence:${roomId}` shared-state channels (the same maps written
 * by {@link usePresence}) and counts entries whose `lastSeen` is recent (within
 * STALE_MS). No writes are made; this is purely observational.
 */

import { useMemo } from 'react';
import { usePageData } from '@playhtml/react';

/** Mirror of the staleness threshold used by usePresence. */
const STALE_MS = 8000;

interface PresenceEntry {
  memberId: string;
  lastSeen: number;
}

type PresenceData = Record<string, PresenceEntry>;

/** Count non-stale entries in a presence map snapshot. */
function countActive(data: PresenceData | null | undefined): number {
  if (!data) return 0;
  const now = Date.now();
  return Object.values(data).filter(
    (e) => e && typeof e.lastSeen === 'number' && now - e.lastSeen <= STALE_MS,
  ).length;
}

/**
 * Hook for a single room's occupancy count.
 * Returns the number of members currently present (0 when empty or loading).
 */
function useRoomCount(roomId: string): number {
  const [data] = usePageData<PresenceData>(`presence:${roomId}`, {});
  return useMemo(() => countActive(data), [data]);
}

/**
 * Hook for multiple rooms at once.
 * Returns a map of roomId → occupancy count.
 *
 * Note: hooks cannot be called in a loop, so we hard-code slots for up to 6
 * rooms (matching the fixed ROOMS list). Extra slots are ignored.
 */
export function useRoomOccupancy(roomIds: readonly string[]): Record<string, number> {
  const c0 = useRoomCount(roomIds[0] ?? '');
  const c1 = useRoomCount(roomIds[1] ?? '');
  const c2 = useRoomCount(roomIds[2] ?? '');
  const c3 = useRoomCount(roomIds[3] ?? '');
  const c4 = useRoomCount(roomIds[4] ?? '');
  const c5 = useRoomCount(roomIds[5] ?? '');

  return useMemo(
    () =>
      Object.fromEntries(
        [c0, c1, c2, c3, c4, c5]
          .slice(0, roomIds.length)
          .map((count, i) => [roomIds[i], count]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c0, c1, c2, c3, c4, c5, roomIds.length],
  );
}
