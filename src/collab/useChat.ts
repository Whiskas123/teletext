/**
 * useChat — playhtml binding for the room chat sidebar (Requirement 5).
 *
 * This hook is a thin wrapper over playhtml's `usePageData` shared-state
 * channel (id `"chat"`). All message validation and attribution logic lives in
 * the pure, framework-free `src/domain/chat.ts` module (`validateChatMessage`,
 * `appendMessage`) so the behavior is unit- and property-testable without a
 * live Yjs connection.
 *
 * API choice (see design.md "Shared-state hooks"): the design sketches both
 * `withSharedState` (an HOC) and `usePageData` (a `useState`-like hook). Because
 * `useChat` is a hook rather than a component, `usePageData<ChatData>('chat',
 * default)` is the natural, cleanly-typed fit — it returns `[data, setData]`
 * where `setData` accepts either a value or an immer-style `(draft) => void`
 * mutator. We use the mutator form so the append is expressed as a mutation of
 * the shared array (merge-friendly) rather than a whole-array replacement.
 *
 * Requirements covered: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7.
 */

import { useCallback, useMemo } from 'react';
import { usePageData } from '@playhtml/react';

import { validateChatMessage } from '../domain/chat';
import { assignColor, defaultDisplayName } from '../domain/identity';
import { getSessionMemberId, getStoredDisplayName } from './session';
import { useRoomId } from './RoomContext';
import { type ChatData, type ChatMessage } from './types';

/** Derive a stable palette-color index from a member id (matches usePresence). */
function colorIndexForMember(memberId: string): number {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Generate a message id, preferring crypto.randomUUID when available. */
function newMessageId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Base id for the chat channel; the effective channel is keyed per Room_ID. */
const CHAT_CHANNEL_ID = 'chat';
/** Build the per-room chat channel id (`chat:${roomId}`). */
const chatChannel = (roomId: string): string => `${CHAT_CHANNEL_ID}:${roomId}`;

/** Default chat data for a room with no messages yet. */
const DEFAULT_CHAT_DATA: ChatData = { messages: [] };

/**
 * Public chat API surface (see design.md "Shared-state hooks: useChat").
 */
export interface ChatApi {
  /** Room chat messages ordered chronologically ascending by timestamp. */
  messages: ChatMessage[];
  /**
   * Submit a chat message.
   *
   * Returns `'ok'` when the trimmed text is 1..500 characters and the message
   * was appended, `'empty'` when the text is empty/whitespace-only, and
   * `'too-long'` when the trimmed text exceeds 500 characters. On a non-`'ok'`
   * result the chat is left unchanged.
   */
  send(text: string): 'ok' | 'empty' | 'too-long';
}

/**
 * Bind the room chat to shared state and expose ordered messages plus a
 * validating `send`.
 */
export function useChat(): ChatApi {
  const roomId = useRoomId();
  const [data, setData] = usePageData<ChatData>(
    chatChannel(roomId),
    DEFAULT_CHAT_DATA,
  );

  // Guarantee chronological ascending order at read time (Req 5.1, 5.7),
  // independent of the order in which concurrent inserts merge across clients.
  const messages = useMemo(
    () => [...(data.messages ?? [])].sort((a, b) => a.ts - b.ts),
    [data.messages],
  );

  const send = useCallback(
    (text: string): 'ok' | 'empty' | 'too-long' => {
      // Validate first so the caller gets a precise rejection reason
      // (Req 5.5 empty, Req 5.6 too-long) and the chat stays unchanged.
      const validation = validateChatMessage(text);
      if (!validation.ok) {
        return validation.reason;
      }

      // Attribute the message with the member's chosen Identity: the display
      // name entered on the landing page (Req 5.3), with a palette color derived
      // consistently with the presence list. Falls back to a generated name only
      // when none was set.
      const memberId = getSessionMemberId();
      const stored = getStoredDisplayName();
      const authorName =
        stored != null && stored.trim().length > 0
          ? stored
          : defaultDisplayName(memberId);

      const message: ChatMessage = {
        id: newMessageId(),
        authorId: memberId,
        authorName,
        authorColor: assignColor(colorIndexForMember(memberId)),
        text: validation.value,
        ts: Date.now(),
      };

      // Push ONLY the new (plain) message onto the shared array. Reassigning the
      // whole array would try to re-insert already-integrated Yjs objects and
      // throw on the second send; pushing a single plain object is the correct,
      // merge-friendly mutation (Req 5.3, 5.4). Order is guaranteed on read.
      setData((draft) => {
        if (!Array.isArray(draft.messages)) draft.messages = [];
        draft.messages.push(message);
      });

      return 'ok';
    },
    [setData],
  );

  return { messages, send };
}
