/**
 * ChatSidebar — the room's live chat sidebar (Requirement 5).
 *
 * Design notes (see design.md "Presentation components" and Req 5):
 * - Reads the room's chat messages and a validating `send` from
 *   {@link useChat} (playhtml-backed shared state). Messages arrive already
 *   ordered chronologically ascending by timestamp, so they render oldest to
 *   newest (Req 5.1).
 * - Each message shows its author's display name drawn in the author's Identity
 *   color, a readable timestamp, and the message text (Req 5.1).
 * - When the room has no messages, an empty-chat indication is shown instead of
 *   an empty area (Req 5.2).
 * - A text input plus send button submit through `send`; a rejection of
 *   `'empty'` or `'too-long'` surfaces an inline error and leaves the input
 *   intact, while an `'ok'` result clears the input (Req 5.4, 5.5, 5.6). The
 *   input advertises the 500-character limit via `maxLength`.
 * - The message list is a `role="log"` region with `aria-live="polite"` so
 *   assistive technology announces newly arriving messages (Req 5.4).
 *
 * Auto-scrolling the list to the newest message is a nice-to-have and is
 * implemented as a best-effort effect.
 *
 * _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useChat } from '../../collab/useChat';
import type { ChatMessage } from '../../collab/types';

/** Empty-chat indication shown when the room has no messages (Req 5.2). */
export const EMPTY_CHAT_LABEL = 'No messages yet. Say hello!';

/** Inline error shown when an empty/whitespace-only message is submitted (Req 5.5). */
export const EMPTY_MESSAGE_ERROR = 'Message cannot be empty';

/** Inline error shown when a message exceeds the length limit (Req 5.6). */
export const TOO_LONG_MESSAGE_ERROR = 'Message exceeds 500 characters';

/** Maximum trimmed message length enforced by the chat service (Req 5.6). */
export const MAX_MESSAGE_LENGTH = 500;

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
 * Render the room chat sidebar: the ordered message log plus a validating
 * input/send control.
 */
export function ChatSidebar() {
  const { messages, send } = useChat();

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
      setError(EMPTY_MESSAGE_ERROR);
      return;
    }
    if (result === 'too-long') {
      // Reject over-length input; keep the draft (Req 5.6).
      setError(TOO_LONG_MESSAGE_ERROR);
      return;
    }
    // 'ok' — message appended; clear the input and any prior error (Req 5.4).
    setError(null);
    setDraft('');
  };

  return (
    <section className="chat-sidebar" aria-label="Room chat">
      <h2 className="sidebar-heading">Chat</h2>

      {messages.length === 0 ? (
        <p className="chat-empty">{EMPTY_CHAT_LABEL}</p>
      ) : (
        <ul
          ref={listRef}
          className="chat-messages"
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {messages.map((message) => (
            <ChatMessageItem key={message.id} message={message} />
          ))}
        </ul>
      )}

      <form className="chat-form" onSubmit={handleSubmit}>
        <label className="sidebar-field-label" htmlFor="chat-message-input">
          Message
        </label>
        <input
          id="chat-message-input"
          className="chat-input"
          type="text"
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type a message…"
          aria-invalid={error !== null}
          aria-describedby={error ? 'chat-message-error' : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) {
              setError(null);
            }
          }}
        />
        <button type="submit" className="sidebar-action-btn">
          Send
        </button>
        {error && (
          <p id="chat-message-error" className="chat-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

export default ChatSidebar;
