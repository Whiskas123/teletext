/**
 * usePresence — Member Identity and presence, over playhtml's presence channel
 * (Requirement 2).
 *
 * Each member publishes `{ memberId, name, color }` on the room's
 * `presence:${roomId}` channel, and the members list is everyone publishing
 * there. This is playhtml's presence, not the shared document: the server
 * relays it to the other clients and never stores it, playhtml republishes it
 * while the tab is open, and drops it when the connection closes or goes stale.
 *
 * ## Why not the shared document any more
 *
 * Presence used to be a heartbeat written into the document every 3 s. A Yjs
 * document keeps a record of every overwritten value, so a room of 30 people
 * left ~250 KB and ~72,000 items behind per hour — permanently, in the one
 * document every visitor downloads. The first room crashed playhtml's server at
 * ~8 MB (see `GlobalProvider.tsx`); presence was the fastest-growing part left.
 *
 * playhtml's presence used to need cursors switched on. Since 2.13 it works
 * with cursors off, which is how this app runs.
 *
 * ## One entry per browser, not per tab
 *
 * playhtml keys presence by its own player identity, which lives in
 * `localStorage`, so two tabs of the same browser are one entry to everyone
 * else (each tab still sees itself). Different people, devices or a private
 * window each count. To test with two windows on one machine, make one private.
 *
 * All identity decisions (name validation/defaults, palette color, who counts)
 * delegate to the pure `src/domain/identity.ts` module.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlayContext, usePresence as usePlayPresence } from '@playhtml/react';

import {
  colorForMember,
  defaultDisplayName,
  membersFromPresence,
  presenceCount,
  validateDisplayName,
  type PresentMember,
} from '../domain/identity';
import {
  getSessionMemberId,
  getStoredDisplayName,
  setStoredDisplayName,
} from './session';
import { useRoomId } from './RoomContext';

/** The presence channel for a room; `useRoomOccupancy` reads the same ones. */
export const presenceChannel = (roomId: string): string => `presence:${roomId}`;

/**
 * A member's public Identity as surfaced to the UI.
 */
export type MemberIdentity = PresentMember;

/**
 * The presence API returned by {@link usePresence}.
 */
export interface PresenceApi {
  /** All members currently present in the room (includes the local member). */
  members: MemberIdentity[];
  /** The local member's current Identity. */
  me: MemberIdentity;
  /** Clamped presence count, `0..ROOM_MAX_MEMBERS` (Req 2.7). */
  count: number;
  /**
   * Request a display-name change. Returns `'ok'` when valid (1..32 chars) and
   * applied, or `'invalid'` when rejected — the previous name is retained.
   */
  setDisplayName(name: string): 'ok' | 'invalid';
}

/**
 * Bind Member Identity + presence to playhtml's presence channel.
 */
export function usePresence(): PresenceApi {
  const roomId = useRoomId();
  const channel = presenceChannel(roomId);
  const { isLoading } = usePlayContext();
  const { presences, setMyPresence } = usePlayPresence<string, PresentMember>(channel);

  const memberId = useMemo(() => getSessionMemberId(), []);
  const color = useMemo(() => colorForMember(memberId), [memberId]);

  // Local display name, seeded from the landing-page choice.
  const [displayName, setDisplayName] = useState<string>(() => {
    const stored = getStoredDisplayName();
    return stored != null && validateDisplayName(stored)
      ? stored
      : defaultDisplayName(memberId);
  });

  const me: MemberIdentity = useMemo(
    () => ({ memberId, name: displayName, color }),
    [memberId, displayName, color],
  );

  // Publish, and re-publish when the name changes. The setter only works once
  // playhtml has connected; before that it warns and drops the value.
  useEffect(() => {
    if (isLoading) return;
    setMyPresence(me);
  }, [isLoading, setMyPresence, me]);

  // Leave the room's channel on unmount or on moving to another room (the
  // setter is per channel). A closed tab needs nothing: the server drops it.
  useEffect(() => {
    if (isLoading) return;
    // playhtml clears the channel on null, though its type only admits a value.
    return () => setMyPresence(null as unknown as PresentMember);
  }, [isLoading, setMyPresence]);

  const members = useMemo(
    () =>
      membersFromPresence(
        Array.from(presences.values(), (view) => view[channel]),
        me,
      ),
    [presences, channel, me],
  );

  const count = useMemo(() => presenceCount(members), [members]);

  const changeDisplayName = useCallback((name: string): 'ok' | 'invalid' => {
    if (!validateDisplayName(name)) {
      return 'invalid';
    }
    setDisplayName(name);
    setStoredDisplayName(name);
    return 'ok';
  }, []);

  return {
    members,
    me,
    count,
    setDisplayName: changeDisplayName,
  };
}
