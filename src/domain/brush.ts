/**
 * Brush history domain logic for the teletext editor.
 *
 * The editor offers several painting brushes. Two of them carry configuration
 * worth remembering: the **block** brush (a motif pattern plus its six colors)
 * and the **pixel** brush (a single color painted into one sixth of a cell).
 * The blink brush has no configuration, so it is not part of the history.
 *
 * This module owns the pure, framework-free rules for the "recently used
 * brushes" list the editor lets members step back and forth through. Keeping it
 * out of the component makes the ordering rules — which are subtle, see
 * {@link recordBrush} — readable and testable on their own.
 */

import type { SixelColors, TeletextColor } from '../types/teletext';

/** A brush configuration worth remembering. */
export type Brush =
  | {
      kind: 'block';
      /** Index into `MOTIF_PATTERNS`. */
      motifIndex: number;
      /** The six per-part colors the motif paints with. */
      colors: SixelColors;
      /**
       * Which of the six sub-cells the brush lights, 0-63.
       *
       * A motif chosen from the picker fills the whole cell (`SIXEL_MAX`) and
       * only varies colour, which is all the block brush could ever do. A brush
       * lifted off the page with the eyedropper carries the shape it found, so
       * the pattern has to travel with the colours or picking up a half-filled
       * cell would paint a solid one.
       */
      pattern: number;
    }
  | { kind: 'pixel'; color: TeletextColor };

/** How many recent brushes are kept. Older entries fall off the end. */
export const BRUSH_HISTORY_MAX = 8;

/** Structural equality: two brushes that would paint identically. */
export function brushesEqual(a: Brush, b: Brush): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'pixel' && b.kind === 'pixel') return a.color === b.color;
  if (a.kind === 'block' && b.kind === 'block') {
    return (
      a.motifIndex === b.motifIndex &&
      a.pattern === b.pattern &&
      a.colors.length === b.colors.length &&
      a.colors.every((c, i) => c === b.colors[i])
    );
  }
  return false;
}

/** A stable key for React lists / lookups. */
export function brushKey(brush: Brush): string {
  return brush.kind === 'pixel'
    ? `pixel:${brush.color}`
    : `block:${brush.motifIndex}:${brush.pattern}:${brush.colors.join('-')}`;
}

/**
 * The state of the recent-brushes strip: the list itself (index 0 = most
 * recently used) and the cursor the ◀ / ▶ stepper moves through it.
 */
export interface BrushHistoryState {
  history: Brush[];
  index: number;
}

/**
 * Record a brush that was just painted with.
 *
 * Normally this prepends the brush (removing any earlier duplicate) and resets
 * the cursor to the front. The exception matters: when the brush is the one the
 * cursor already points at — i.e. the member stepped back to an older brush and
 * is now painting with it — the list and cursor are left alone. Reshuffling
 * there would move the entry out from under the stepper and make going forward
 * again impossible.
 *
 * Total: never throws, and always returns a list of at most
 * {@link BRUSH_HISTORY_MAX} entries with an in-range cursor.
 */
export function recordBrush(
  history: readonly Brush[],
  index: number,
  brush: Brush,
): BrushHistoryState {
  const current = history[index];
  if (current && brushesEqual(current, brush)) {
    return { history: [...history], index };
  }
  const next = [brush, ...history.filter((b) => !brushesEqual(b, brush))];
  return { history: next.slice(0, BRUSH_HISTORY_MAX), index: 0 };
}

/**
 * Move the history cursor by `delta` (negative = towards more recent), clamped
 * to the bounds of the list. An empty history always yields index 0.
 */
export function stepBrush(
  history: readonly Brush[],
  index: number,
  delta: number,
): number {
  if (history.length === 0) return 0;
  const target = index + delta;
  return Math.min(history.length - 1, Math.max(0, target));
}
