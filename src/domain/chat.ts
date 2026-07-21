/**
 * Pure chat-domain helpers for Collaborative Teletext Rooms.
 *
 * This module is framework-free and side-effect-free so it can be unit- and
 * property-tested without a live playhtml/Yjs connection. It reuses the shared
 * collaborative chat shapes (`ChatMessage`) and the `TeletextColor` primitive
 * from `src/collab/types.ts`.
 *
 * Requirements covered: 5.1, 5.3, 5.5, 5.6, 5.7.
 * Correctness properties: 15 (chat message validation is exactly trimmed-length
 * bounded), 16 (sending appends one attributed message in chronological order).
 */

import type { ChatMessage, TeletextColor } from '../collab/types';

/** Minimum trimmed chat-message length (inclusive). */
const MIN_MESSAGE_LENGTH = 1;
/** Maximum trimmed chat-message length (inclusive). */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Result of validating a candidate chat message.
 *
 * On success, `value` is the trimmed message text (1..500 characters). On
 * failure, `reason` distinguishes an empty/whitespace-only message from one
 * whose trimmed length exceeds the limit.
 */
export type ChatMessageValidation =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-long' };

/**
 * The author Identity attached to an appended {@link ChatMessage}.
 *
 * Mirrors the attribution fields of {@link ChatMessage} so a caller can supply
 * a member's Identity directly.
 */
export interface MessageAuthor {
  /** Stable client id of the author. */
  authorId: string;
  /** Author display name (Identity) captured at send time. */
  authorName: string;
  /** Author color (Identity) captured at send time. */
  authorColor: TeletextColor | string;
}

/**
 * Validate a candidate chat message.
 *
 * Accepts the message if and only if its text, after trimming leading and
 * trailing whitespace, has length in the inclusive range 1..500. An
 * empty/whitespace-only message is rejected with reason `'empty'`; a message
 * whose trimmed length exceeds 500 is rejected with reason `'too-long'`. On
 * success the returned `value` is the trimmed text.
 *
 * Requirements: 5.3 (accept 1..500), 5.5 (reject empty/whitespace-only), 5.6
 * (reject over-length). Property 15.
 */
export function validateChatMessage(raw: string): ChatMessageValidation {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_MESSAGE_LENGTH) {
    return { ok: false, reason: 'empty' };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Generate a message id, preferring `crypto.randomUUID` when available.
 *
 * Guarded for environments where `crypto`/`randomUUID` is unavailable so the
 * module stays pure and usable in tests; callers may inject a deterministic id
 * via {@link appendMessage} instead.
 */
function generateMessageId(): string {
  const c: unknown = (globalThis as { crypto?: unknown }).crypto;
  if (
    c &&
    typeof (c as { randomUUID?: unknown }).randomUUID === 'function'
  ) {
    return (c as { randomUUID: () => string }).randomUUID();
  }
  // Fallback: sufficiently-unique id for non-crypto environments.
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Validate `text` and append exactly one attributed {@link ChatMessage} to
 * `messages`, returning a new array ordered ascending by timestamp `ts`.
 *
 * The input `messages` array is never mutated. When `text` is invalid (empty,
 * whitespace-only, or over-length) the original `messages` array is returned
 * unchanged so callers can treat a no-op as "chat unchanged". The appended
 * message carries the author Identity (`authorId`/`authorName`/`authorColor`),
 * the given `ts`, the trimmed text, and an id (either the injected `id` or a
 * generated one, keeping the function deterministic when an id is supplied).
 *
 * The result is always sorted ascending by `ts` using a stable insertion so
 * messages sharing a timestamp preserve their relative order (the newly
 * appended message sorts after existing messages with an equal `ts`).
 *
 * Requirements: 5.1 (chronological order), 5.3 (attributed with author +
 * timestamp), 5.7 (ordered oldest-to-newest). Property 16.
 */
export function appendMessage(
  messages: readonly ChatMessage[],
  text: string,
  author: MessageAuthor,
  ts: number,
  id?: string,
): ChatMessage[] {
  const validation = validateChatMessage(text);
  if (!validation.ok) {
    // Invalid submission is a no-op: leave the chat unchanged.
    return messages.slice();
  }

  const message: ChatMessage = {
    id: id ?? generateMessageId(),
    authorId: author.authorId,
    authorName: author.authorName,
    authorColor: author.authorColor,
    text: validation.value,
    ts,
  };

  // Append the new message, then stably sort ascending by timestamp. A stable
  // sort (guaranteed by ECMAScript) preserves the relative order of messages
  // sharing a timestamp, so the newly appended message sorts after existing
  // messages with an equal `ts` while the whole result is ordered oldest-to-
  // newest regardless of the input order.
  const next = [...messages, message];
  next.sort((a, b) => a.ts - b.ts);
  return next;
}
