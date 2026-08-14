/**
 * Folding one page into another's carousel.
 *
 * Teletext ran a story longer than one screen across consecutive page numbers —
 * NOTÍCIAS on 117, 118, 119 — because that is what a broadcaster could do with
 * a numbering plan. They were one story, and the archive inherited them as
 * three unrelated pages. Absorbing 118 and 119 into 117's subpages puts the
 * story back together and frees two numbers, which in a 600-slot range is the
 * scarce thing.
 *
 * It is a move, not a copy: the source's screens land at the end of the
 * target's carousel and the source page is left empty. That is the whole reason
 * to do it, so the refusals below are what stop it being destructive by
 * accident.
 *
 * Pure and framework-free, so the rules are testable without a live document.
 */

import { MAX_SUBPAGE, MIN_SUBPAGE, normalizeSubpageCount } from './subpages';
import { inPageRange } from './pageOps';

/** Why a page cannot be folded into another. */
export type AbsorbRefusal =
  /** Not a page number, or outside 100..999. */
  | 'no-page'
  /** A page cannot be its own subpage. */
  | 'same-page'
  /** Nothing there to absorb. */
  | 'empty-source'
  /** The two carousels together are longer than a page may be. */
  | 'too-many';

/** What folding `source` into `target` would do. */
export interface AbsorbPlan {
  ok: true;
  target: number;
  source: number;
  /** How many screens travel — the source's whole carousel, not just its first. */
  moving: number;
  /** The subpage its first screen lands on. */
  firstSubpage: number;
}

export type AbsorbPreview = AbsorbPlan | { ok: false; reason: AbsorbRefusal };

export interface AbsorbInput {
  target: number;
  /** The page to fold in. `NaN` while the field is empty or half-typed. */
  source: number;
  targetCount: number;
  sourceCount: number;
  /** Every page holding something, so an empty source can be refused. */
  occupied: ReadonlySet<number>;
}

/**
 * Whether `source` may be folded into `target`, and what it would cost.
 *
 * Refuses rather than clamping throughout: this destroys the source page, and
 * quietly absorbing *some* of a carousel because the rest did not fit would
 * leave the operator with half a story in each of two places.
 */
export function previewAbsorb({
  target,
  source,
  targetCount,
  sourceCount,
  occupied,
}: AbsorbInput): AbsorbPreview {
  if (!Number.isInteger(source) || !inPageRange(source)) {
    return { ok: false, reason: 'no-page' };
  }
  if (source === target) {
    return { ok: false, reason: 'same-page' };
  }
  if (!occupied.has(source)) {
    return { ok: false, reason: 'empty-source' };
  }

  const from = normalizeSubpageCount(targetCount);
  const moving = normalizeSubpageCount(sourceCount);
  if (from + moving > MAX_SUBPAGE) {
    return { ok: false, reason: 'too-many' };
  }

  return {
    ok: true,
    target,
    source,
    moving,
    firstSubpage: from + MIN_SUBPAGE,
  };
}

/**
 * What the preview says on the card, in a sentence.
 *
 * Names the number that is freed as well as the one that grows: the operator is
 * about to empty a page, and a control that only mentions the half that gains
 * something is how a page gets destroyed by someone who thought they were
 * copying it.
 */
export function describeAbsorb(preview: AbsorbPreview): string {
  if (preview.ok) {
    const { source, target, moving, firstSubpage } = preview;
    const where =
      moving === 1
        ? `subpage ${firstSubpage}`
        : `subpages ${firstSubpage}–${firstSubpage + moving - 1}`;
    return (
      `Page ${source} moves to ${where} of page ${target}` +
      `${moving > 1 ? ` (${moving} screens)` : ''}, and ${source} is left empty.`
    );
  }

  switch (preview.reason) {
    case 'no-page':
      return 'Type the number of a page to fold in, or leave it blank for an empty subpage.';
    case 'same-page':
      return 'A page cannot be a subpage of itself.';
    case 'empty-source':
      return 'That page holds nothing to absorb.';
    case 'too-many':
      return `Together they would be longer than ${MAX_SUBPAGE} subpages.`;
  }
}
