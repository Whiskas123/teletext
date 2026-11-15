/**
 * useEditPresence — who else is editing this screen, and where their cursor is.
 *
 * The playground is public and `/edit` was solo: two people on the same page
 * drew over each other without either knowing the other was there. Each editor
 * now says which screen it has open and the cell it last touched, on playhtml's
 * presence channel — relayed, never stored, and dropped when the tab closes
 * (see `usePresence.ts` for why presence is not in the shared document).
 *
 * What arrives is whatever another browser chose to send, so it is checked
 * before it is drawn: a cursor off the page is ignored, a name that is not a
 * valid one is replaced, and the colour is worked out here from the member id
 * rather than taken on trust.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayContext, usePresence as usePlayPresence } from '@playhtml/react';

import { colorForMember, defaultDisplayName, validateDisplayName } from '../domain/identity';
import { COLS, TOTAL_CELLS } from '../types/teletext';
import { getSessionMemberId, getStoredDisplayName, setStoredDisplayName } from './session';

const CHANNEL = 'presence:edit';

/** A cursor is published at most this often: a stroke moves it sixty times a second. */
const PUBLISH_INTERVAL_MS = 250;

/** More cursors than this on one screen is a crowd nobody can read. */
const MAX_OTHERS = 12;

type EditPresence = { memberId: string; name: string; screen: string; cursor: number };

export interface EditPresenceApi {
  /** The other editors of this screen; shaped as the editor's remote cursors. */
  others: { index: number; name: string; color: string }[];
  /** Tell the others where this editor's cursor now is. */
  setCursor(index: number | null): void;
  /** The name and colour the others see on this editor's cursor. */
  name: string;
  color: string;
  /** Change it; false (and the old name kept) when it is not a valid one. */
  setName(name: string): boolean;
}

export function useEditPresence(screen: string): EditPresenceApi {
  const { isLoading } = usePlayContext();
  const { presences, setMyPresence } = usePlayPresence<string, EditPresence>(CHANNEL);
  const memberId = useMemo(() => getSessionMemberId(), []);
  // The same stored name the rooms use, so it is chosen once for the site.
  const [name, setNameState] = useState(() => {
    const stored = getStoredDisplayName();
    return validateDisplayName(stored) ? (stored as string) : defaultDisplayName(memberId);
  });
  const setName = useCallback((next: string) => {
    if (!validateDisplayName(next)) return false;
    setNameState(next);
    setStoredDisplayName(next);
    return true;
  }, []);

  const screenRef = useRef(screen);
  const cursorRef = useRef(COLS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The setter only works once playhtml has connected; before that it drops
  // the value, so connecting is one of the things that publishes.
  const publish = useCallback(() => {
    if (isLoading) return;
    setMyPresence({ memberId, name, screen: screenRef.current, cursor: cursorRef.current });
  }, [isLoading, setMyPresence, memberId, name]);

  useEffect(() => {
    screenRef.current = screen;
    publish();
  }, [screen, publish]);

  useEffect(() => {
    if (isLoading) return;
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = null;
      // playhtml clears the channel on null, though its type only admits a value.
      setMyPresence(null as unknown as EditPresence);
    };
  }, [isLoading, setMyPresence]);

  const setCursor = useCallback(
    (index: number | null) => {
      if (index == null) return;
      cursorRef.current = index;
      timerRef.current ??= setTimeout(() => {
        timerRef.current = null;
        publish();
      }, PUBLISH_INTERVAL_MS);
    },
    [publish],
  );

  const others = useMemo(() => {
    const list: EditPresenceApi['others'] = [];
    for (const view of presences.values()) {
      const seen = view[CHANNEL] as Partial<EditPresence> | null | undefined;
      if (seen == null || typeof seen.memberId !== 'string' || seen.memberId === memberId) continue;
      if (seen.screen !== screen) continue;
      const index = seen.cursor;
      if (!Number.isInteger(index) || index! < COLS || index! >= TOTAL_CELLS) continue;
      list.push({
        index: index!,
        name: validateDisplayName(seen.name) ? (seen.name as string) : defaultDisplayName(seen.memberId),
        color: colorForMember(seen.memberId),
      });
      if (list.length >= MAX_OTHERS) break;
    }
    return list;
  }, [presences, screen, memberId]);

  return { others, setCursor, name, color: colorForMember(memberId), setName };
}
