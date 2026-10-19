/**
 * useRoomOccupancy — read-only snapshot of how many members are present in
 * each of the given room IDs, for display on the landing page.
 *
 * Reads the same presence channels {@link usePresence} publishes on, counting
 * the clients that are in each room. Nothing is published from here, so the
 * visitor on the landing page is not counted in any room.
 */

import { useMemo } from 'react';
import { usePresence as usePlayPresence } from '@playhtml/react';

import { membersFromPresence } from '../domain/identity';
import { presenceChannel } from './usePresence';

/**
 * Hook for a single room's occupancy count.
 * Returns the number of members currently present (0 when empty or loading).
 */
function useRoomCount(roomId: string): number {
  const channel = presenceChannel(roomId);
  const { presences } = usePlayPresence<Record<string, unknown>>(channel);
  return useMemo(
    () => membersFromPresence(Array.from(presences.values(), (view) => view[channel])).length,
    [presences, channel],
  );
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
