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

/**
 * Where a page's picture is written at build time, and how the front page finds
 * it before any JavaScript has run.
 *
 * ## The problem
 *
 * The strip used to be discovered entirely at runtime: the bundle booted,
 * `useShowcase` asked `/api/showcase` what was on the strip — half a second, a
 * function invocation and a database query — and only then did the `<img>`s
 * exist for the browser to start fetching. Nothing about the strip could begin
 * until the slowest part of the page had finished. For a front page whose whole
 * argument is "this is a service, on air", arriving in three stages is the
 * wrong first impression.
 *
 * ## What happens instead
 *
 * `scripts/prerender.ts` already talks to the database at build time, so it
 * writes each chosen page's picture into `dist/showcase/` as a plain file and
 * lists them in the landing page's own HTML — as `<link rel="preload">` tags
 * the browser's preload scanner finds while the bundle is still downloading,
 * and as a small JSON block the hook reads for its first render.
 *
 * So by the time React has anything to draw, the pictures are already in the
 * browser's cache, and they came from the CDN rather than from a function.
 *
 * ## Staying fresh anyway
 *
 * A build is a snapshot: a page put on the strip on `/manage` afterwards is not
 * in `dist/`. The hook still asks `/api/showcase`, and anything it does not
 * recognise from the build keeps the endpoint's URL — so a new page appears
 * within the second, exactly as it did before, and is baked in at the next
 * deploy. This is the same trade the prerenderer already makes with page text.
 */

/** The `<script type="application/json">` the build writes the strip into. */
export const SHOWCASE_BOOT_ID = 'showcase-boot';

/** The folder under `dist/` — and so the URL prefix — for the pictures. */
export const SHOWCASE_DIR = 'showcase';

/** One page on the strip as the build knows it: the row, plus its picture. */
export interface ShowcaseBootEntry {
  page_number: number;
  subpage: number;
  position: number;
  title: string;
  updated_at: string;
  /** The static picture, written for exactly this version of the page. */
  src: string;
}

/**
 * A page's picture, named for the *version* it shows.
 *
 * The timestamp is in the file name for the same reason `showcaseImageUrl` puts
 * it in the query string: pressing Redraw has to change the address, or every
 * browser and every edge that cached the old picture goes on serving it. With
 * the version in the name the bytes at a given path can never change, which is
 * what lets `vercel.json` mark the folder immutable.
 *
 * The punctuation is dropped rather than escaped — `2026-08-16T15:28:48.638Z`
 * becomes `20260816152848638` — because a colon in a URL path is legal, awful
 * to read, and encoded differently by different things that handle it.
 */
export function showcasePicturePath(
  pageNumber: number,
  subpage: number,
  version: string,
  extension = 'png',
): string {
  return `/${SHOWCASE_DIR}/${pageNumber}-${subpage}-${version.replace(/\D/g, '')}.${extension}`;
}

/**
 * How a page and a version are matched between the build and the endpoint.
 *
 * The version is part of the key on purpose: a page that was redrawn since the
 * build is the *same* page at a different version, and the build's picture of
 * it is out of date. Keying on the number alone would show the old drawing
 * until the next deploy — silently, which is the worst way for it to be wrong.
 */
export function showcaseVersionKey(
  pageNumber: number,
  subpage: number,
  version: string,
): string {
  return `${pageNumber}.${subpage}.${version}`;
}
