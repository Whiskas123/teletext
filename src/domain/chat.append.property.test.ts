// Feature: collaborative-teletext-rooms, Property 16: Sending appends one attributed message in chronological order
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { appendMessage, type MessageAuthor } from './chat';
import type { ChatMessage } from '../collab/types';
import { TELETEXT_COLORS, type TeletextColor } from '../types/teletext';

/**
 * Property 16: Sending appends one attributed message in chronological order.
 *
 * For any chat and any valid message text, appending adds exactly one
 * ChatMessage carrying the author Identity and a timestamp, and the resulting
 * messages are ordered ascending by timestamp. An invalid message text
 * (empty/whitespace-only or over-length) leaves the messages unchanged.
 *
 * **Validates: Requirements 5.1, 5.3, 5.7**
 */

const colorArb: fc.Arbitrary<TeletextColor | string> = fc.oneof(
  fc.constantFrom(...(TELETEXT_COLORS as readonly TeletextColor[])),
  fc
    .integer({ min: 0, max: 0xffffff })
    .map((n) => `#${n.toString(16).padStart(6, '0')}`),
);

const authorArb: fc.Arbitrary<MessageAuthor> = fc.record({
  authorId: fc.string({ minLength: 1, maxLength: 24 }),
  authorName: fc.string({ minLength: 1, maxLength: 32 }),
  authorColor: colorArb,
});

/** A single existing ChatMessage (its `ts` is assigned by the sorted-list arb).
 * Existing ids live in a distinct `old-` namespace so they can never collide
 * with the injected (`new-`) id of the appended message — that keeps the
 * "exactly one message with the injected id" assertion sound. */
const baseMessageArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `old-${s}`),
  authorId: fc.string({ minLength: 1, maxLength: 12 }),
  authorName: fc.string({ minLength: 1, maxLength: 12 }),
  authorColor: colorArb,
  text: fc.string({ minLength: 1, maxLength: 50 }),
});

/**
 * An already-sorted (ascending `ts`) list of existing ChatMessages. Timestamps
 * are produced from a sorted set of non-negative integers so the precondition
 * "existing messages are chronological" holds.
 */
const existingMessagesArb: fc.Arbitrary<ChatMessage[]> = fc
  .array(baseMessageArb, { minLength: 0, maxLength: 20 })
  .chain((partials) =>
    fc
      .array(fc.integer({ min: 0, max: 2_000_000 }), {
        minLength: partials.length,
        maxLength: partials.length,
      })
      .map((rawTimestamps) => {
        const timestamps = [...rawTimestamps].sort((a, b) => a - b);
        return partials.map(
          (p, i): ChatMessage => ({ ...p, ts: timestamps[i] }),
        );
      }),
  );

/** A valid message text whose trimmed length is within 1..500. */
const validTextArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => {
    const t = s.trim().length;
    return t >= 1 && t <= 500;
  });

/** An invalid message text: empty/whitespace-only or trimmed length > 500. */
const invalidTextArb: fc.Arbitrary<string> = fc.oneof(
  // Empty or whitespace-only.
  fc.stringMatching(/^\s*$/),
  // Over-length: trimmed length strictly greater than 500.
  fc
    .integer({ min: 501, max: 600 })
    .map((n) => 'a'.repeat(n)),
);

const tsArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 2_000_000 });
// Injected id lives in a distinct `new-` namespace so it never collides with an
// existing message's `old-` id (see baseMessageArb).
const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .map((s) => `new-${s}`);

describe('Property 16: Sending appends one attributed message in chronological order', () => {
  it('appends exactly one attributed message and keeps messages sorted ascending by ts', () => {
    fc.assert(
      fc.property(
        existingMessagesArb,
        validTextArb,
        authorArb,
        tsArb,
        idArb,
        (existing, text, author, ts, id) => {
          const result = appendMessage(existing, text, author, ts, id);

          // Exactly one message was added (Req 5.1).
          expect(result).toHaveLength(existing.length + 1);

          // Exactly one message carries the injected id.
          const appended = result.filter((m) => m.id === id);
          expect(appended).toHaveLength(1);
          const msg = appended[0];

          // The appended message carries the author Identity, the trimmed text,
          // and the given timestamp (Req 5.3).
          expect(msg.authorId).toBe(author.authorId);
          expect(msg.authorName).toBe(author.authorName);
          expect(msg.authorColor).toBe(author.authorColor);
          expect(msg.text).toBe(text.trim());
          expect(msg.ts).toBe(ts);

          // The result is ordered ascending by timestamp (Req 5.7).
          for (let i = 1; i < result.length; i += 1) {
            expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
          }

          // Every pre-existing message is still present (nothing dropped).
          for (const prev of existing) {
            expect(
              result.some(
                (m) =>
                  m.id === prev.id &&
                  m.ts === prev.ts &&
                  m.text === prev.text &&
                  m.authorId === prev.authorId,
              ),
            ).toBe(true);
          }

          // The input array is not mutated.
          expect(existing).toHaveLength(result.length - 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaves messages unchanged for an invalid message text (no-op)', () => {
    fc.assert(
      fc.property(
        existingMessagesArb,
        invalidTextArb,
        authorArb,
        tsArb,
        idArb,
        (existing, text, author, ts, id) => {
          const result = appendMessage(existing, text, author, ts, id);

          // No message added: same length and same contents (Req 5.1/5.3).
          expect(result).toHaveLength(existing.length);
          expect(result).toEqual(existing);
        },
      ),
      { numRuns: 100 },
    );
  });
});
