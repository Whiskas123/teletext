/**
 * A "recently used" list with a cursor, for the editor's history strips.
 *
 * The brush strip and the text-style strip behave identically — most-recent
 * first, no duplicates, a stepper you can walk backwards and forwards through —
 * and the rule that makes them work is easy to get wrong (see {@link recordRecent}).
 * It lives here once, generic over the item and its equality, rather than twice.
 *
 * Pure and framework-free.
 */

/** The list itself (index 0 = most recently used) and the stepper's cursor. */
export interface RecentList<T> {
  history: T[];
  index: number;
}

/** Whether two items are the same for history purposes. */
export type Equals<T> = (a: T, b: T) => boolean;

/**
 * Record an item that was just used.
 *
 * Normally this prepends it (removing any earlier duplicate) and resets the
 * cursor to the front. The exception is what makes the stepper usable: when the
 * item *is* the one the cursor already points at — the member stepped back to an
 * older entry and is now using it — the list and cursor are left exactly as they
 * are. Reshuffling there would move the entry out from under the stepper, and
 * stepping forward again would be impossible.
 *
 * Total: never throws, and always returns at most `max` entries with an in-range
 * cursor.
 */
export function recordRecent<T>(
  history: readonly T[],
  index: number,
  item: T,
  equals: Equals<T>,
  max: number,
): RecentList<T> {
  const current = history[index];
  if (current !== undefined && equals(current, item)) {
    return { history: [...history], index };
  }
  const next = [item, ...history.filter((entry) => !equals(entry, item))];
  return { history: next.slice(0, Math.max(1, max)), index: 0 };
}

/**
 * Move the cursor by `delta` (negative = towards more recent), clamped to the
 * list. An empty list always yields 0.
 */
export function stepRecent<T>(
  history: readonly T[],
  index: number,
  delta: number,
): number {
  if (history.length === 0) return 0;
  return Math.min(history.length - 1, Math.max(0, index + delta));
}
