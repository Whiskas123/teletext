/**
 * ChatSidebar — the room's chat, as the second console in the rail (Req 5).
 *
 * It stands under the vote console and is built out of the same parts: a
 * nameplate across the top, the panel's plastic behind it, moulded keys. What is
 * different is that a conversation is the one thing on this screen that is not an
 * instrument reading, so the log itself is left alone — plain text on a dark
 * ground, the author's name in the colour their Identity was assigned, and no
 * attempt to letter it in the panel's condensed face. A chat engraved on a
 * control panel would be unreadable and slightly absurd.
 *
 * The presence roster is folded into its head rather than standing as a third
 * panel above it (see {@link PresenceList}): the names in the log are the same
 * names, and a standing column of them pushed the conversation off the bottom of
 * the rail for no gain.
 *
 * Behaviour, all through {@link useChat}:
 * - Messages arrive ordered oldest to newest and render that way (Req 5.1), each
 *   with its author's display name in their Identity colour and a readable time.
 * - An empty room says so rather than showing an empty box (Req 5.2).
 * - `send` validates: `'empty'` and `'too-long'` surface inline and keep the
 *   draft, `'ok'` clears it (Req 5.4, 5.5, 5.6). The field advertises the
 *   500-character limit through `maxLength`.
 * - The log is a `role="log"` with `aria-live="polite"`, so a new message is
 *   announced rather than silently appearing (Req 5.4).
 *
 * Scrolling to the newest message is best-effort, in an effect.
 *
 * _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { COPY } from '../../domain/copy';
import { DEFAULT_LANGUAGE } from '../../domain/landing';
import { useChat } from '../../collab/useChat';
import type { ChatMessage } from '../../collab/types';
import PresenceList from './PresenceList';
import { useCopy } from './useCopy';

/*
 * The strings below are the copy table's entries for the default language, not
 * second copies of them.
 *
 * They exist because the tests name them, and because a test that spells the
 * words out again is a test that fails the day somebody rewords the interface —
 * which is exactly the change least worth failing over. Pointing them at
 * {@link COPY} means there is still one place the words live.
 */

/** Empty-chat indication shown when the room has no messages (Req 5.2). */
export const EMPTY_CHAT_LABEL = COPY[DEFAULT_LANGUAGE].chat.empty;

/** Inline error shown when an empty/whitespace-only message is submitted (Req 5.5). */
export const EMPTY_MESSAGE_ERROR = COPY[DEFAULT_LANGUAGE].chat.errorEmpty;

/** Inline error shown when a message exceeds the length limit (Req 5.6). */
export const TOO_LONG_MESSAGE_ERROR = COPY[DEFAULT_LANGUAGE].chat.errorTooLong;

/** Maximum trimmed message length enforced by the chat service (Req 5.6). */
export const MAX_MESSAGE_LENGTH = 500;

/** The console's nameplate. */
export const CHAT_HEADING = COPY[DEFAULT_LANGUAGE].chat.name;

/** Format a chat message timestamp into a readable, locale-aware time (Req 5.1). */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Render a single chat message row: author (colored), timestamp, and text. */
function ChatMessageItem({ message }: { message: ChatMessage }) {
  return (
    <li className="chat-message">
      <div className="chat-message-meta">
        <span className="chat-message-author" style={{ color: message.authorColor }}>
          {message.authorName}
        </span>
        <time className="chat-message-time" dateTime={new Date(message.ts).toISOString()}>
          {formatTimestamp(message.ts)}
        </time>
      </div>
      <p className="chat-message-text">{message.text}</p>
    </li>
  );
}

/**
 * Render the room chat console: the roster in its head, the ordered message log,
 * and a validating composer.
 */
export function ChatSidebar() {
  const { messages, send } = useChat();
  const copy = useCopy();

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Best-effort auto-scroll to the newest message when the list changes.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = send(draft);
    if (result === 'empty') {
      // Reject empty/whitespace-only input; keep the draft (Req 5.5).
      setError(copy.chat.errorEmpty);
      return;
    }
    if (result === 'too-long') {
      // Reject over-length input; keep the draft (Req 5.6).
      setError(copy.chat.errorTooLong);
      return;
    }
    // 'ok' — message appended; clear the input and any prior error (Req 5.4).
    setError(null);
    setDraft('');
  };

  return (
    <section className="room-console chat-console" aria-label={copy.chat.region}>
      <div className="rc-nameplate">
        <h2 className="rc-nameplate-name">{copy.chat.name}</h2>
      </div>

      {/* The room is the one place a member sets their display name. */}
      <PresenceList allowRename />

      {messages.length === 0 ? (
        <p className="chat-empty">{copy.chat.empty}</p>
      ) : (
        <ul
          ref={listRef}
          className="chat-messages"
          role="log"
          aria-live="polite"
          aria-label={copy.chat.log}
        >
          {messages.map((message) => (
            <ChatMessageItem key={message.id} message={message} />
          ))}
        </ul>
      )}

      <form className="chat-form" onSubmit={handleSubmit}>
        {/*
          * No visible label. The console has a nameplate reading CHAT and one
          * field under it — a legend saying "Message" over the only thing you can
          * type into is a form being polite about itself. The accessible name is
          * still there for anyone who cannot see the arrangement.
          */}
        <input
          id="chat-message-input"
          className="rc-field chat-input"
          type="text"
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={copy.chat.placeholder}
          aria-label={copy.chat.messageLabel}
          aria-invalid={error !== null}
          aria-describedby={error ? 'chat-message-error' : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) {
              setError(null);
            }
          }}
        />
        <button type="submit" className="rc-key chat-send">
          {copy.chat.send}
        </button>
        {error && (
          <p id="chat-message-error" className="rc-note chat-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

export default ChatSidebar;
