/**
 * usePresence — Member Identity and presence, backed by synced shared state
 * (Requirement 2).
 *
 * Presence is published into the same synced playhtml document that pages, chat
 * and votes use, rather than playhtml's ephemeral awareness. Awareness rides on
 * the cursor channel, which the app disables, so it does not reliably propagate
 * between clients; a shared-state heartbeat does, so two browsers in the same
 * room see each other.
 *
 * Each member periodically writes a small entry `{ memberId, name, color,
 * lastSeen }` into a per-room `presence:${roomId}` map. The members list is the
 * set of entries whose `lastSeen` is recent; a member who leaves (or whose tab
 * closes) simply stops heartbeating and drops out once their entry goes stale.
 * On unmount the local entry is removed immediately.
 *
 * All identity decisions (name validation/defaults, palette color) delegate to
 * the pure `src/domain/identity.ts` module.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageData } from '@playhtml/react';

import {
  assignColor,
  defaultDisplayName,
  presenceCount,
  validateDisplayName,
} from '../domain/identity';
import {
  getSessionMemberId,
  getStoredDisplayName,
  setStoredDisplayName,
} from './session';
import { useRoomId } from './RoomContext';
import type { TeletextColor } from './types';

/** How often each member re-publishes its presence heartbeat. */
const HEARTBEAT_MS = 3000;
/** A member is considered present while its last heartbeat is within this window. */
const STALE_MS = 8000;
/** Entries older than this are pruned from the shared map to keep it tidy. */
const PRUNE_MS = 20000;

/** Base id for the presence channel; the effective channel is keyed per Room_ID. */
const PRESENCE_CHANNEL = 'presence';
const presenceChannel = (roomId: string): string => `${PRESENCE_CHANNEL}:${roomId}`;

/** A single member's heartbeat entry in the shared presence map. */
interface PresenceEntry {
  memberId: string;
  name: string;
  color: TeletextColor | string;
  /** Epoch ms of this member's most recent heartbeat. */
  lastSeen: number;
}

/** The shared presence map, keyed by member id. */
type PresenceData = Record<string, PresenceEntry>;

/**
 * A member's public Identity as surfaced to the UI.
 */
export interface MemberIdentity {
  memberId: string;
  name: string;
  color: TeletextColor | string;
}

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

/** Derive a stable, non-negative palette-color index from a member id. */
function colorIndexForMember(memberId: string): number {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Bind Member Identity + presence to synced shared state.
 */
export function usePresence(): PresenceApi {
  const roomId = useRoomId();
  const [data, setData] = usePageData<PresenceData>(presenceChannel(roomId), {});

  const memberId = useMemo(() => getSessionMemberId(), []);
  const color = useMemo(
    () => assignColor(colorIndexForMember(memberId)),
    [memberId],
  );

  // Local display name, seeded from the landing-page choice.
  const [displayName, setDisplayName] = useState<string>(() => {
    const stored = getStoredDisplayName();
    return stored != null && validateDisplayName(stored)
      ? stored
      : defaultDisplayName(memberId);
  });

  // Keep the latest identity in a ref so the heartbeat interval always writes
  // current values without being re-armed on every change. Written from an
  // effect, and declared above the heartbeat so it has landed before the first
  // beat reads it — effects run in declaration order.
  const identityRef = useRef({ memberId, name: displayName, color });
  useEffect(() => {
    identityRef.current = { memberId, name: displayName, color };
  }, [memberId, displayName, color]);

  // Heartbeat: publish our entry immediately, then on an interval; prune stale
  // entries so departed members drop out. Remove our entry on unmount (Req 2.6).
  useEffect(() => {
    const writeHeartbeat = () => {
      const { memberId: id, name, color: c } = identityRef.current;
      setData((draft) => {
        const now = Date.now();
        draft[id] = { memberId: id, name, color: c, lastSeen: now };
        // Retire clearly-dead entries (well past the stale window) by dating
        // them to the epoch rather than removing them.
        //
        // `delete draft[key]` throws "unable to delete property" — playhtml's
        // draft is a Proxy with no `deleteProperty` trap — and the exception
        // aborts the whole mutator, taking this heartbeat with it. So once any
        // member went stale, presence stopped updating for everyone.
        //
        // A zero `lastSeen` is indistinguishable from absence to every reader:
        // membership is decided by freshness (see STALE_MS below), not by the
        // key existing. The map then keeps one retired entry per member id
        // instead of shrinking, which is bounded by distinct members rather
        // than by time.
        for (const key of Object.keys(draft)) {
          if (draft[key].lastSeen > 0 && now - draft[key].lastSeen > PRUNE_MS) {
            draft[key] = { ...draft[key], lastSeen: 0 };
          }
        }
      });
    };

    writeHeartbeat();
    const timer = setInterval(writeHeartbeat, HEARTBEAT_MS);

    return () => {
      clearInterval(timer);
      // Best-effort: retire our entry so others see us leave promptly. Dated
      // to the epoch rather than deleted, for the reason above.
      setData((draft) => {
        const id = identityRef.current.memberId;
        if (draft[id] != null) draft[id] = { ...draft[id], lastSeen: 0 };
      });
    };
  }, [setData, roomId]);

  // Re-publish immediately when the display name changes so peers update fast.
  useEffect(() => {
    setData((draft) => {
      draft[memberId] = {
        memberId,
        name: displayName,
        color,
        lastSeen: Date.now(),
      };
    });
  }, [setData, memberId, displayName, color]);

  const me: MemberIdentity = useMemo(
    () => ({ memberId, name: displayName, color }),
    [memberId, displayName, color],
  );

  /*
   * The clock, as state rather than as a `Date.now()` in the middle of the memo
   * below.
   *
   * Membership is a question about *now* — an entry counts if its heartbeat is
   * recent — so the answer changes with time and not only with the data. Sampled
   * during render it changed only when something else did, which meant a member
   * who closed their tab stayed in the list until the next heartbeat from anyone
   * happened to re-run the memo. Ticking a value in state instead makes the
   * passage of time an input like any other, and the list empties on its own.
   *
   * One tick per heartbeat: the stale window is a little under three of them, so
   * this is as often as the answer can actually change.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  // The present members: entries with a recent heartbeat, deduped, with the
  // local member authoritative for its own Identity (so `me` always appears).
  const members = useMemo<MemberIdentity[]>(() => {
    const byId = new Map<string, MemberIdentity>();
    for (const entry of Object.values(data ?? {})) {
      if (!entry || typeof entry.memberId !== 'string') continue;
      if (now - entry.lastSeen > STALE_MS) continue; // stale → treat as gone
      byId.set(entry.memberId, {
        memberId: entry.memberId,
        name:
          typeof entry.name === 'string' && validateDisplayName(entry.name)
            ? entry.name
            : defaultDisplayName(entry.memberId),
        color:
          typeof entry.color === 'string'
            ? entry.color
            : assignColor(colorIndexForMember(entry.memberId)),
      });
    }
    byId.set(me.memberId, me);
    return Array.from(byId.values());
  }, [data, me, now]);

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
