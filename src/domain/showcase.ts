/**
 * How the front page's strip runs.
 *
 * *What* is on it is no longer decided here. It used to be: this module read
 * the live document, excluded the playground, skipped pages with no ink and
 * offered whatever had the lowest numbers. That was never a choice — the front
 * page showed page 100 because 100 is the lowest number. A moderator picks the
 * strip now, on `/manage`, and the list arrives from `/api/showcase` already in
 * their order (see `src/collab/useShowcase.ts`).
 *
 * What is left is the two decisions the strip still makes for itself: how fast
 * it moves, and in what order it meets a given visitor.
 *
 * Pure and framework-free, so the shuffle is property-tested without rendering.
 */

/**
 * Seconds each page takes to cross, so the speed is the same at any count.
 *
 * The animation is one long slide of the whole track, so a longer strip needs
 * proportionally longer — otherwise a strip of twelve would race past while a
 * strip of three crawled.
 */
export const SHOWCASE_SECONDS_PER_SCREEN = 7;

/**
 * The strip in a random order, decided once per visit.
 *
 * Two visitors, and two visits, should not meet the same run of pages in the
 * same sequence — the archive is hundreds of pages, and a fixed order makes it
 * look like a handful.
 *
 * Seeded rather than calling `Math.random` inside the shuffle, for two reasons.
 * The strip renders its pages *twice* so the loop has no seam, and both copies
 * must be in the same order or the join would jump; and a component may re-run
 * a memo at any time, which with an unseeded shuffle would reorder the strip
 * under the reader.
 *
 * Fisher–Yates over a small deterministic generator: every permutation is
 * reachable and none is favoured, which `sort(() => Math.random() - 0.5)`
 * cannot claim.
 */
export function shuffleBySeed<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];

  // mulberry32: small, fast, and good enough to shuffle a dozen pages.
  let state = Math.floor(Math.abs(seed) * 0xffffffff) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
