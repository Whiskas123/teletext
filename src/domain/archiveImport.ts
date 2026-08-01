/**
 * Decode a teletext archive render into a {@link TeletextPage}.
 *
 * ## Why this is a lookup and not image recognition
 *
 * The archive's renderer emits a GIF drawn from the 8-colour teletext palette
 * with no anti-aliasing and no scaling: the image is exactly 40x25 character
 * cells, and every pixel is one of the eight palette colours. Nothing is
 * approximate, so nothing here guesses (with one documented exception — see
 * {@link RenderProfile.homoglyphDigits}):
 *
 * - a cell whose six sixel sub-rectangles are each a flat colour is block
 *   graphics, and the exact pattern falls straight out of the six colours;
 * - the same six blocks drawn each inset by a gap is *separated* graphics,
 *   equally decidable from the pixels;
 * - any other two-colour cell is a character, and the *identical* stencil is
 *   drawn every time that character appears — so it is looked up in a
 *   {@link RenderProfile}'s atlas rather than recognised.
 *
 * (An earlier attempt ran OCR over archive *screenshots*, where rescaling and
 * anti-aliasing had already destroyed the pixel grid. Feeding it the
 * renderer's own GIFs instead removes the problem rather than fighting it.)
 *
 * ## Five render sizes, two broadcasters
 *
 * RTP published at three sizes over the years and SIC at two, and the archive
 * holds all five. A {@link RenderProfile} carries everything that differs: cell
 * size, row count, where the sixel sub-cells divide, and the glyph atlas.
 * {@link profileFor} picks one from the image's dimensions, so a caller just
 * hands over pixels.
 *
 * Two of those differences were once assumed away, and both made SIC's half of
 * the archive undecodable until they were modelled properly:
 *
 * - **Row count is per profile.** RTP renders 40x25 and one row is dropped on
 *   import; SIC renders 40x24, with the header already gone, and nothing is
 *   dropped. `SOURCE_ROWS` used to be a module constant asserting 25 for every
 *   size, which is why a SIC render could not even be recognised.
 * - **The font is per profile, not per cell size.** SIC's 320x240 cells are the
 *   same 8x10 as RTP's 320x250, and yet not one stencil is shared between them:
 *   SIC draws with two-pixel stems where RTP draws with one. Matching cell
 *   dimensions says nothing about matching glyphs.
 *
 * Anything an atlas does not know is reported in
 * {@link ImportResult.unknownGlyphs} rather than guessed at, so the caller can
 * show it to a human and grow the atlas — see `components/Room/ImportArchivePage`.
 *
 * Everything in this module is pure and framework-free so it can be tested
 * without a browser; turning a `File` into pixels lives in `utils/archiveImage.ts`.
 */

import { GLYPH_ATLAS_13X16 } from './data/glyphAtlas';
import { GLYPH_ATLAS_10X12 } from './data/glyphAtlas10x12';
import { GLYPH_ATLAS_8X10 } from './data/glyphAtlas8x10';
import { GLYPH_ATLAS_SIC_8X10 } from './data/glyphAtlasSic8x10';
import { GLYPH_ATLAS_SIC_12X14 } from './data/glyphAtlasSic12x14';
import {
  COLS,
  ROWS,
  TELETEXT_COLOR_HEX,
  TELETEXT_COLORS,
  createEmptyPage,
  indexAt,
  type Cell,
  type SixelColors,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';

/**
 * The row count RTP's renderers emit: a full 25-row teletext page including the
 * header line, one row taller than our own {@link ROWS}-tall pages, so exactly
 * one row is dropped on import (see `chooseRowOffset`).
 *
 * This is *not* true of every render size, which it was once assumed to be.
 * SIC's renderers emit 24 rows — the header is already gone — so there is
 * nothing to drop. Row count is therefore a property of the profile
 * ({@link RenderProfile.sourceRows}); this constant remains as the RTP value
 * and as the name the tests refer to.
 */
export const SOURCE_ROWS = ROWS + 1;

/** Everything that differs between the archive's render sizes. */
export interface RenderProfile {
  /** Human-readable size, for error messages. */
  readonly name: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /**
   * Rows this renderer emits: 25 for RTP (a header row that gets dropped), 24
   * for SIC (already trimmed, so every row survives). When this equals
   * {@link ROWS} no row is dropped and `droppedRow` comes back `null`.
   */
  readonly sourceRows: number;
  /**
   * Sixel sub-cell column bounds, `[0, split, cellWidth]`, and row bounds,
   * `[0, a, b, cellHeight]`. Measured off the corpus per size rather than
   * derived: cell dimensions rarely divide evenly by 2 and 3, and the
   * renderer's rounding is not something to guess at (13x16 splits its rows
   * 5/6/5, 8x10 splits them 3/4/3).
   */
  readonly sixelX: readonly [number, number, number];
  readonly sixelY: readonly [number, number, number, number];
  /**
   * Pixel columns and rows carrying the gap in *separated* graphics, measured
   * per size like the sixel bounds. Not derivable from them: 13x16 gives up its
   * last column so both blocks come out 5 wide, while 10x12 and 8x10 divide
   * evenly already and keep theirs.
   */
  readonly gapX: readonly number[];
  readonly gapY: readonly number[];
  /** Stencil -> character for this size's font. */
  readonly atlas: Record<string, string>;
  /**
   * Characters this renderer draws with pixels *identical* to another
   * character's, mapped to that twin.
   *
   * SIC's 8x10 font draws capital `O` and digit `0` from the same stencil —
   * verified, not assumed: the `O` in `MUNDO` and the `0` in `220` on the same
   * rendered line produce the same key. (RTP's fonts do distinguish them, which
   * is why this only arises here.)
   *
   * No amount of looking at one cell can tell those apart, so this is the one
   * place the decoder cannot be exact. {@link resolveHomoglyphs} settles it from
   * the surrounding run of text instead — see there for the rule and its limits.
   */
  readonly homoglyphDigits?: Readonly<Record<string, string>>;
  /** Pixel columns/rows that must be background in a separated-graphics cell. */
  readonly separatedGapX: ReadonlySet<number>;
  readonly separatedGapY: ReadonlySet<number>;
  /** Extents of each separated block, as `[start, end)` between the gaps. */
  readonly separatedX: readonly (readonly [number, number])[];
  readonly separatedY: readonly (readonly [number, number])[];
}

/**
 * Work a profile's separated-graphics blocks out from its measured gaps: they
 * are simply the runs of pixels between them. An empty run is dropped (the
 * first gap column sits at x=0, so nothing lies to its left) and a run after
 * the last gap is kept (10x12 and 8x10 have no trailing gap column).
 */
function withSeparatedGeometry(
  base: Omit<RenderProfile, 'separatedGapX' | 'separatedGapY' | 'separatedX' | 'separatedY'>,
): RenderProfile {
  const spans = (gaps: readonly number[], limit: number): [number, number][] => {
    const out: [number, number][] = [];
    let start = 0;
    for (const gap of gaps) {
      if (gap > start) out.push([start, gap]);
      start = gap + 1;
    }
    if (start < limit) out.push([start, limit]);
    return out;
  };

  return {
    ...base,
    separatedGapX: new Set(base.gapX),
    separatedGapY: new Set(base.gapY),
    separatedX: spans(base.gapX, base.cellWidth),
    separatedY: spans(base.gapY, base.cellHeight),
  };
}

/**
 * Every render size the archive published, largest first. Sizes are distinct,
 * so a profile is identified by the image's dimensions alone.
 */
export const RENDER_PROFILES: readonly RenderProfile[] = [
  withSeparatedGeometry({
    name: '520x400',
    sourceRows: SOURCE_ROWS,
    cellWidth: 13,
    cellHeight: 16,
    sixelX: [0, 6, 13],
    sixelY: [0, 5, 11, 16],
    gapX: [0, 6, 12],
    gapY: [4, 10, 15],
    atlas: GLYPH_ATLAS_13X16,
  }),
  withSeparatedGeometry({
    name: '400x300',
    sourceRows: SOURCE_ROWS,
    cellWidth: 10,
    cellHeight: 12,
    sixelX: [0, 5, 10],
    sixelY: [0, 4, 8, 12],
    gapX: [0, 5],
    gapY: [3, 7, 11],
    atlas: GLYPH_ATLAS_10X12,
  }),
  withSeparatedGeometry({
    name: '320x250',
    sourceRows: SOURCE_ROWS,
    cellWidth: 8,
    cellHeight: 10,
    sixelX: [0, 4, 8],
    sixelY: [0, 3, 7, 10],
    gapX: [0, 4],
    gapY: [2, 6, 9],
    atlas: GLYPH_ATLAS_8X10,
  }),
  // SIC's two sizes. Both emit 24 rows rather than 25 — the header line is
  // already gone — and both use a font of their own, so they need their own
  // atlases even where the cell size matches an RTP profile exactly.
  withSeparatedGeometry({
    name: '320x240',
    sourceRows: ROWS,
    cellWidth: 8,
    cellHeight: 10,
    sixelX: [0, 4, 8],
    sixelY: [0, 3, 7, 10],
    gapX: [0, 4],
    gapY: [2, 6, 9],
    atlas: GLYPH_ATLAS_SIC_8X10,
    homoglyphDigits: { O: '0' },
  }),
  withSeparatedGeometry({
    name: '480x336',
    sourceRows: ROWS,
    cellWidth: 12,
    cellHeight: 14,
    // Measured off block-graphics cells in the corpus, not derived: the three
    // sixel bands are 4/6/4 pixel rows, not the even split 14/3 would suggest.
    sixelX: [0, 6, 12],
    sixelY: [0, 4, 10, 14],
    gapX: [0, 6],
    gapY: [3, 9, 13],
    atlas: GLYPH_ATLAS_SIC_12X14,
    homoglyphDigits: { O: '0' },
  }),
];

/** The size the archive's most recent renderer used; the reference profile. */
export const NATIVE_PROFILE = RENDER_PROFILES[0];

/** Native pixel size of a profile's render. */
export function profileWidth(profile: RenderProfile): number {
  return COLS * profile.cellWidth;
}
export function profileHeight(profile: RenderProfile): number {
  return profile.sourceRows * profile.cellHeight;
}

/** Every accepted native size, for messages that have to list them. */
export function acceptedSizes(): string {
  return RENDER_PROFILES.map((p) => p.name).join(', ');
}

/** RGB triples for the palette, in {@link TELETEXT_COLORS} order. */
const PALETTE_RGB: readonly (readonly [number, number, number])[] =
  TELETEXT_COLORS.map((name) => {
    const hex = TELETEXT_COLOR_HEX[name];
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ] as const;
  });

/** A stencil the atlas has no character for, with everything needed to name it. */
export interface UnknownGlyph {
  /** {@link glyphKey} of the stencil, i.e. the atlas key it would be filed under. */
  key: string;
  /** Cell indices (into the imported page) where this stencil appeared. */
  cells: number[];
  /** Row-major 13x16 bitmap, `true` where the character's ink is. For display. */
  bitmap: boolean[][];
}

export interface ImportResult {
  page: TeletextPage;
  /** Which render size this image turned out to be. */
  profile: RenderProfile;
  /** Distinct unrecognised stencils, most-used first. Empty on a clean import. */
  unknownGlyphs: UnknownGlyph[];
  /**
   * Which source row was dropped to fit 25 rendered rows into 24 — see
   * `chooseRowOffset`. `null` when the renderer emits 24 rows already (SIC's
   * do), in which case no row was dropped.
   */
  droppedRow: 'first' | 'last' | null;
  /**
   * Whether the dropped row actually held anything. Normally false: a render
   * has 25 rows and a page has 24, so one always goes, and it is almost always
   * a blank one. True means the import genuinely lost a line and someone
   * should look at what was on it.
   */
  droppedRowHadContent: boolean;
  /**
   * Pixels that were not exactly a palette colour and had to be snapped to the
   * nearest one. Expected to be 0; anything else means the source was rescaled
   * or recompressed and the result should be treated with suspicion.
   */
  snappedPixels: number;
}

export class ArchiveImportError extends Error {}

/** Minimal structural view of an `ImageData`, so this module needs no DOM types. */
export interface SourcePixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

/**
 * The atlas key for a 13x16 stencil: 16 groups of 4 hex digits, one per pixel
 * row, most-significant bit leftmost. The sole producer of atlas keys — see
 * `domain/data/glyphAtlas.ts` for the matching description of the format.
 */
export function glyphKey(bitmap: readonly (readonly boolean[])[]): string {
  const width = bitmap[0]?.length ?? 0;
  let key = '';
  for (const row of bitmap) {
    let bits = 0;
    for (let x = 0; x < width; x++) {
      if (row[x]) bits |= 1 << (width - 1 - x);
    }
    key += bits.toString(16).padStart(4, '0');
  }
  return key;
}

/**
 * The render profile `pixels` matches and the whole-number factor it is scaled
 * by, or `null` if it is not one of the archive's render sizes. Only exact
 * integer multiples are accepted: a non-integer scale means the image was
 * resampled, which destroys the pixel-exactness the whole approach rests on.
 */
export function profileFor(
  pixels: SourcePixels,
): { profile: RenderProfile; scale: number } | null {
  const { width, height } = pixels;
  for (const profile of RENDER_PROFILES) {
    const nativeWidth = profileWidth(profile);
    const nativeHeight = profileHeight(profile);
    if (width % nativeWidth !== 0 || height % nativeHeight !== 0) continue;
    const scale = width / nativeWidth;
    if (scale >= 1 && height / nativeHeight === scale) return { profile, scale };
  }
  return null;
}

/**
 * Read the source as a grid of palette colours, one entry per native pixel,
 * indexed `[y][x]`. At scale > 1 each native pixel is sampled from the centre
 * of its block rather than averaged, so an upscaled render decodes identically
 * to a native one.
 */
function readPalettePixels(
  pixels: SourcePixels,
  profile: RenderProfile,
  scale: number,
): { grid: TeletextColor[][]; snapped: number } {
  const { data, width } = pixels;
  const sourceWidth = profileWidth(profile);
  const sourceHeight = profileHeight(profile);
  const half = Math.floor(scale / 2);
  const grid: TeletextColor[][] = [];
  let snapped = 0;

  for (let y = 0; y < sourceHeight; y++) {
    const row: TeletextColor[] = new Array(sourceWidth);
    const sy = y * scale + half;
    for (let x = 0; x < sourceWidth; x++) {
      const offset = (sy * width + x * scale + half) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];

      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < PALETTE_RGB.length; i++) {
        const [pr, pg, pb] = PALETTE_RGB[i];
        const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (bestDistance !== 0) snapped++;
      row[x] = TELETEXT_COLORS[best];
    }
    grid.push(row);
  }

  return { grid, snapped };
}

/** The six sixel sub-cell colours if every sub-rectangle is flat, else `null`. */
function sixelColors(
  profile: RenderProfile,
  grid: TeletextColor[][],
  originX: number,
  originY: number,
): TeletextColor[] | null {
  const { sixelX, sixelY } = profile;
  const parts: TeletextColor[] = [];
  for (let sr = 0; sr < 3; sr++) {
    for (let sc = 0; sc < 2; sc++) {
      const color = grid[originY + sixelY[sr]][originX + sixelX[sc]];
      for (let y = sixelY[sr]; y < sixelY[sr + 1]; y++) {
        for (let x = sixelX[sc]; x < sixelX[sc + 1]; x++) {
          if (grid[originY + y][originX + x] !== color) return null;
        }
      }
      parts.push(color);
    }
  }
  return parts;
}

/**
 * The six sub-cell colours if this is a *separated* graphics cell, else `null`.
 * Every gap pixel must be one single colour (the background) and every inset
 * block flat; a block whose colour equals the gap colour is simply unset.
 */
function separatedSixelColors(
  profile: RenderProfile,
  grid: TeletextColor[][],
  originX: number,
  originY: number,
): { parts: TeletextColor[]; background: TeletextColor } | null {
  let background: TeletextColor | null = null;
  for (let y = 0; y < profile.cellHeight; y++) {
    for (let x = 0; x < profile.cellWidth; x++) {
      if (!profile.separatedGapX.has(x) && !profile.separatedGapY.has(y)) continue;
      const color = grid[originY + y][originX + x];
      if (background == null) background = color;
      else if (background !== color) return null;
    }
  }
  if (background == null) return null;

  const parts: TeletextColor[] = [];
  for (const [y0, y1] of profile.separatedY) {
    for (const [x0, x1] of profile.separatedX) {
      const color = grid[originY + y0][originX + x0];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (grid[originY + y][originX + x] !== color) return null;
        }
      }
      parts.push(color);
    }
  }
  return { parts, background };
}

/**
 * Whether a cell's rows come in identical pairs — the mark of one half of a
 * double-height line, which the renderer draws by doubling every source row.
 */
function isRowDoubled(
  profile: RenderProfile,
  grid: TeletextColor[][],
  originX: number,
  originY: number,
): boolean {
  for (let pair = 0; pair < Math.floor(profile.cellHeight / 2); pair++) {
    for (let x = 0; x < profile.cellWidth; x++) {
      if (grid[originY + pair * 2][originX + x] !== grid[originY + pair * 2 + 1][originX + x]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The character a double-height pair spells, if the cell at (`originX`,
 * `originY`) and the one below it are the two stretched halves of one glyph.
 *
 * A double-height line is drawn at twice the height across two cells, each row
 * of the original doubled. Un-doubling both halves and putting them back
 * together reconstructs the original 16-row stencil, which is looked up in the
 * same atlas as everything else — so double height costs the atlas nothing, and
 * a character learnt at one height is known at both.
 */
function doubleHeightMatch(
  profile: RenderProfile,
  grid: TeletextColor[][],
  col: number,
  row: number,
  atlas: Record<string, string>,
): { char: string; fg: TeletextColor; bg: TeletextColor } | null {
  if (row + 1 >= profile.sourceRows) return null;
  // An odd cell height cannot be a clean 2x stretch of anything, so this
  // renderer simply has no double height at that size.
  if (profile.cellHeight % 2 !== 0) return null;
  const { cellWidth, cellHeight } = profile;
  const originX = col * cellWidth;
  const topY = row * cellHeight;
  const bottomY = topY + cellHeight;
  if (!isRowDoubled(profile, grid, originX, topY) ||
      !isRowDoubled(profile, grid, originX, bottomY)) return null;

  const counts = new Map<TeletextColor, number>();
  const rows: TeletextColor[][] = [];
  for (const y0 of [topY, bottomY]) {
    for (let pair = 0; pair < cellHeight / 2; pair++) {
      const line: TeletextColor[] = [];
      for (let x = 0; x < cellWidth; x++) {
        const color = grid[y0 + pair * 2][originX + x];
        line.push(color);
        // Count the doubled row once per source pixel it stands for, so the
        // majority colour is the same one the single-height path would pick.
        counts.set(color, (counts.get(color) ?? 0) + 2);
      }
      rows.push(line);
    }
  }

  const byFrequency = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (byFrequency.length !== 2) return null;

  for (const [ink, other] of [
    [byFrequency[1][0], byFrequency[0][0]],
    [byFrequency[0][0], byFrequency[1][0]],
  ] as const) {
    const bitmap = rows.map((line) => line.map((color) => color === ink));
    const char = atlas[glyphKey(bitmap)];
    if (char != null) return { char, fg: ink, bg: other };
  }
  return null;
}

/**
 * Settle characters the renderer draws identically, using the run of text they
 * sit in (see {@link RenderProfile.homoglyphDigits}).
 *
 * ## Why this exists, given nothing else here guesses
 *
 * Everywhere else the decode is exact: one stencil means one character, always.
 * SIC's font breaks that by drawing `O` and `0` with the same pixels, so the
 * information simply is not in the image. Something has to choose, and choosing
 * from context is right far more often than always picking one — `2O1/2O2` and
 * `MUNDO` are both wrong under a fixed choice, and both right under this rule.
 *
 * ## The rule
 *
 * Split the row into runs of adjacent non-space cells, then let the first
 * *unambiguous* character in each run decide the whole run: a digit makes the
 * ambiguous cells digits, a letter makes them letters. A run with no
 * unambiguous character keeps the atlas's own reading.
 *
 * So `220` and `2O1` resolve on their leading `2`, `707` on its `7`, while
 * `MUNDO` and `NOTÍCIAS` resolve on `M` and `N`. `500E` resolves on the `5`,
 * ahead of the trailing `E`, because the *first* such character decides rather
 * than a majority.
 *
 * ## Where it is still wrong
 *
 * A run whose first unambiguous character disagrees with the rest — a price
 * written `10 000E`, whose second run `000E` leads with a letter — comes out as
 * `OOOE`. Rare, and visibly wrong rather than plausibly wrong, which is the
 * better failure. The rendered page is unaffected either way: the same stencil
 * was drawn, so the picture is identical and only the stored text differs.
 */
function resolveHomoglyphs(
  cells: Cell[],
  homoglyphDigits: Readonly<Record<string, string>>,
): void {
  const digitOf = (char: string): string | undefined => homoglyphDigits[char];
  const letterOf = (char: string): string | undefined => {
    for (const [letter, digit] of Object.entries(homoglyphDigits)) {
      if (digit === char) return letter;
    }
    return undefined;
  };

  let runStart = 0;
  while (runStart < cells.length) {
    // Graphics cells and blanks both end a run: a run is a word.
    if (cells[runStart].graphics != null || cells[runStart].char === ' ') {
      runStart += 1;
      continue;
    }
    let runEnd = runStart;
    while (
      runEnd < cells.length &&
      cells[runEnd].graphics == null &&
      cells[runEnd].char !== ' '
    ) {
      runEnd += 1;
    }

    // What the first character that is not itself ambiguous says this run is.
    let wantDigit: boolean | null = null;
    for (let i = runStart; i < runEnd; i += 1) {
      const char = cells[i].char;
      if (digitOf(char) != null || letterOf(char) != null) continue;
      if (/[0-9]/.test(char)) {
        wantDigit = true;
        break;
      }
      if (/[^\W\d_]/u.test(char)) {
        wantDigit = false;
        break;
      }
    }

    if (wantDigit != null) {
      for (let i = runStart; i < runEnd; i += 1) {
        const char = cells[i].char;
        const swapped = wantDigit ? digitOf(char) : letterOf(char);
        if (swapped != null) cells[i] = { ...cells[i], char: swapped };
      }
    }

    runStart = runEnd;
  }
}

/** Bitmap of a cell, `true` wherever the pixel is `ink`. */
function stencil(
  profile: RenderProfile,
  grid: TeletextColor[][],
  originX: number,
  originY: number,
  ink: TeletextColor,
): boolean[][] {
  const bitmap: boolean[][] = [];
  for (let y = 0; y < profile.cellHeight; y++) {
    const row: boolean[] = new Array(profile.cellWidth);
    for (let x = 0; x < profile.cellWidth; x++) {
      row[x] = grid[originY + y][originX + x] === ink;
    }
    bitmap.push(row);
  }
  return bitmap;
}

/**
 * Which of a rendered page's 25 rows to drop so it fits our 24-row pages.
 *
 * Dropping the *last* row is much the better option and is why it is tried
 * first: it leaves every other row at the height it was rendered at, and — the
 * part that actually bites — it keeps content out of row 0, where the grid
 * paints its own page number and clock over whatever the cell holds
 * (`TeletextGrid`'s header overlay). Shifting everything up a row would feed
 * the render's first line of text straight into that.
 *
 * Only when the last row carries content and the header row does not is
 * shifting up worth it: row 0 of a render is the teletext header, which our
 * pages regenerate anyway, so there it costs nothing and saves a real line.
 * When both carry content something has to give, and the last row goes.
 */
function chooseRowOffset(
  blankRows: readonly boolean[],
  sourceRows: number,
): 'first' | 'last' | null {
  // A renderer that already emits exactly our row count has nothing spare to
  // drop — SIC's do. Dropping a row here would silently lose a line of the page.
  if (sourceRows <= ROWS) return null;
  if (blankRows[sourceRows - 1]) return 'last';
  return blankRows[0] ? 'first' : 'last';
}

/**
 * Decode a rendered archive page.
 *
 * @throws {ArchiveImportError} if the image is not the renderer's native size
 * or a whole multiple of it — the format is exact, so a mismatch means this is
 * not an archive render (a screenshot, a crop, a rescale) and decoding it
 * would silently produce garbage.
 */
export function importArchiveImage(
  pixels: SourcePixels,
  extraGlyphs?: Record<string, string>,
): ImportResult {
  const match = profileFor(pixels);
  if (match == null) {
    throw new ArchiveImportError(
      `Expected an archive render (${acceptedSizes()}, or a whole multiple of ` +
        `one), got ${pixels.width}x${pixels.height}.`,
    );
  }
  const { profile, scale } = match;
  const atlas = extraGlyphs == null ? profile.atlas : { ...profile.atlas, ...extraGlyphs };

  const { grid, snapped } = readPalettePixels(pixels, profile, scale);
  const rowBackgrounds = readRowBackgrounds(profile, grid);

  // Decode every rendered row first, then decide which one to drop, so the
  // choice can be made from what the rows actually contain.
  const rows: Cell[][] = [];
  const blankRows: boolean[] = [];
  // Keyed by stencil; cells are recorded as source (row, col) and remapped to
  // page indices once the row offset is known.
  const unknown = new Map<string, { bitmap: boolean[][]; at: [number, number][] }>();

  // Set on the lower half of each double-height pair: its content belongs to
  // the cell above, which renders over it, so it must not be decoded again.
  const covered: Cell[] = new Array(profile.sourceRows * COLS);

  for (let row = 0; row < profile.sourceRows; row++) {
    const cells: Cell[] = [];
    let blank = true;
    for (let col = 0; col < COLS; col++) {
      const alreadyCovered = covered[row * COLS + col];
      if (alreadyCovered != null) {
        cells.push(alreadyCovered);
        continue;
      }

      const originX = col * profile.cellWidth;
      const originY = row * profile.cellHeight;
      const decoded = decodeCell(profile, grid, originX, originY, atlas, rowBackgrounds[row]);

      // Double height is tried only for cells nothing else explained — either
      // unrecognised, or blank, since a double-height comma has no ink at all
      // in its upper half. Anything already read as graphics or as a normal
      // character stays that way: those readings are exact, and a pair of them
      // could otherwise be talked into spelling a letter by coincidence.
      const unexplained =
        decoded.unknown != null || (decoded.cell.char === ' ' && decoded.cell.graphics == null);
      const tall = unexplained ? doubleHeightMatch(profile, grid, col, row, atlas) : null;
      if (tall != null) {
        cells.push({
          char: tall.char,
          fg: tall.fg,
          bg: tall.bg,
          graphics: null,
          doubleHeight: true,
        });
        // The lower half renders nothing of its own — the cell above spans it.
        covered[(row + 1) * COLS + col] = {
          char: ' ',
          fg: tall.fg,
          bg: tall.bg,
          graphics: null,
        };
        blank = false;
        continue;
      }

      if (decoded.unknown != null) {
        const { key, bitmap } = decoded.unknown;
        const entry = unknown.get(key) ?? { bitmap, at: [] };
        entry.at.push([row, col]);
        unknown.set(key, entry);
      }

      const cell = decoded.cell;
      if (cell.char !== ' ' || cell.graphics != null) blank = false;
      cells.push(cell);
    }
    // Settle O-vs-0 and any other pair this renderer draws identically, using
    // the row's own words as context (see resolveHomoglyphs).
    if (profile.homoglyphDigits != null) {
      resolveHomoglyphs(cells, profile.homoglyphDigits);
    }

    rows.push(cells);
    blankRows.push(blank);
  }

  const droppedRow = chooseRowOffset(blankRows, profile.sourceRows);
  const rowOffset = droppedRow === 'first' ? 1 : 0;

  const page: TeletextPage = createEmptyPage();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      page[indexAt(col, row)] = rows[row + rowOffset][col];
    }
  }

  const unknownGlyphs: UnknownGlyph[] = [...unknown.entries()]
    .map(([key, { bitmap, at }]) => ({
      key,
      bitmap,
      cells: at
        .filter(([row]) => row - rowOffset >= 0 && row - rowOffset < ROWS)
        .map(([row, col]) => indexAt(col, row - rowOffset)),
    }))
    .filter((glyph) => glyph.cells.length > 0)
    .sort((a, b) => b.cells.length - a.cells.length);

  return {
    page,
    profile,
    unknownGlyphs,
    droppedRow,
    // Nothing was dropped when the renderer emits exactly our row count, so
    // nothing can have been lost with it.
    droppedRowHadContent:
      droppedRow == null
        ? false
        : !blankRows[droppedRow === 'first' ? 0 : profile.sourceRows - 1],
    snappedPixels: snapped,
  };
}

/**
 * The prevailing background colour of each rendered row: the most common
 * colour among that row's flat cells, or `null` for a row with none.
 *
 * Used to settle which of a graphics cell's two colours is the background
 * ({@link decodeCell}). Area alone cannot: a pattern like `0b001011` covers
 * more of the cell in foreground than background, because the renderer's sixel
 * sub-cells are unequal sizes. Both readings look identical on screen, but
 * only one leaves the page's colours the way a person would have set them.
 */
function readRowBackgrounds(
  profile: RenderProfile,
  grid: TeletextColor[][],
): (TeletextColor | null)[] {
  const backgrounds: (TeletextColor | null)[] = [];
  for (let row = 0; row < profile.sourceRows; row++) {
    const counts = new Map<TeletextColor, number>();
    for (let col = 0; col < COLS; col++) {
      const originX = col * profile.cellWidth;
      const originY = row * profile.cellHeight;
      const first = grid[originY][originX];
      let flat = true;
      for (let y = 0; flat && y < profile.cellHeight; y++) {
        for (let x = 0; x < profile.cellWidth; x++) {
          if (grid[originY + y][originX + x] !== first) {
            flat = false;
            break;
          }
        }
      }
      if (flat) counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    backgrounds.push(ranked.length > 0 ? ranked[0][0] : null);
  }
  return backgrounds;
}

/**
 * Decode one character cell.
 *
 * Order matters. Block graphics is tried first because it is decidable from
 * the pixels alone — six flat sub-rectangles is a pattern no character stencil
 * in the atlas produces. Text is tried second, against both possible readings
 * of which colour is the ink (the majority colour is usually the background,
 * but a stencil with more ink than background would invert that, so both are
 * looked up). Separated graphics sits between the two: same six blocks, drawn
 * with a gap, which is decidable from the pixels just as solid graphics is.
 *
 * A cell none of those explain comes back marked `unknown` rather than guessed
 * at, and imported as its background colour alone. Deciding what to do about
 * that is the caller's — it still has double height to try.
 */
function decodeCell(
  profile: RenderProfile,
  grid: TeletextColor[][],
  originX: number,
  originY: number,
  atlas: Record<string, string>,
  rowBackground: TeletextColor | null,
): { cell: Cell; unknown?: { key: string; bitmap: boolean[][] } } {
  const counts = new Map<TeletextColor, number>();
  for (let y = 0; y < profile.cellHeight; y++) {
    for (let x = 0; x < profile.cellWidth; x++) {
      const color = grid[originY + y][originX + x];
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const byFrequency = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const background = byFrequency[0][0];

  // Flat cell: a space on that background. A fully-set graphics block would be
  // pixel-identical, and a space is the simpler thing to hand a human editor.
  if (byFrequency.length === 1) {
    return { cell: { char: ' ', fg: 'white', bg: background, graphics: null } };
  }

  if (byFrequency.length === 2) {
    const [[major], [minor]] = byFrequency;

    const parts = sixelColors(profile, grid, originX, originY);
    if (parts != null) {
      // Real teletext graphics are one foreground over one background. Which
      // is which follows the rest of the row where that settles it, and the
      // colour covering more of the cell otherwise.
      const bg =
        rowBackground === major || rowBackground === minor ? rowBackground : major;
      const fg = bg === major ? minor : major;
      const pattern = parts.reduce(
        (bits, color, i) => (color === fg ? bits | (1 << i) : bits),
        0,
      );
      const colors = parts.map(() => fg) as unknown as SixelColors;
      return { cell: { char: ' ', fg, bg, graphics: pattern, graphicsColors: colors } };
    }

    const separated = separatedSixelColors(profile, grid, originX, originY);
    if (separated != null) {
      const bg = separated.background;
      const fg = bg === major ? minor : major;
      const pattern = separated.parts.reduce(
        (bits, color, i) => (color !== bg ? bits | (1 << i) : bits),
        0,
      );
      const colors = separated.parts.map(() => fg) as unknown as SixelColors;
      return { cell: { char: ' ', fg, bg, graphics: pattern, graphicsColors: colors } };
    }

    for (const ink of [minor, major]) {
      const bitmap = stencil(profile, grid, originX, originY, ink);
      const char = atlas[glyphKey(bitmap)];
      if (char != null) {
        return {
          cell: {
            char,
            fg: ink,
            bg: ink === minor ? major : minor,
            graphics: null,
          },
        };
      }
    }

    const bitmap = stencil(profile, grid, originX, originY, minor);
    return {
      cell: { char: ' ', fg: minor, bg: major, graphics: null },
      unknown: { key: glyphKey(bitmap), bitmap },
    };
  }

  // Three or more colours in one cell is not something the renderer produces
  // for text, but our own pages allow a different colour per sixel, so this
  // reproduces it exactly rather than discarding it.
  const parts = sixelColors(profile, grid, originX, originY) ??
    separatedSixelColors(profile, grid, originX, originY)?.parts ?? null;
  if (parts != null) {
    return {
      cell: {
        char: ' ',
        fg: parts[0],
        bg: background,
        graphics: 0x3f,
        graphicsColors: parts as unknown as SixelColors,
      },
    };
  }

  const bitmap = stencil(profile, grid, originX, originY, byFrequency[1][0]);
  return {
    cell: { char: ' ', fg: 'white', bg: background, graphics: null },
    unknown: { key: glyphKey(bitmap), bitmap },
  };
}
