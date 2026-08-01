/**
 * Tests for `domain/archiveImport.ts`.
 *
 * Two kinds of check, because they fail for different reasons:
 *
 * - **Golden**, against the two real renders in `archive-samples/`. These are
 *   what catches a broken glyph atlas or a wrong cell boundary — the sort of
 *   thing that still produces a plausible-looking page.
 * - **Round-trip**, against pages painted pixel by pixel here. These pin the
 *   cell/sixel geometry and the colour handling to specific values without
 *   needing a real render that happens to contain the case.
 */

import { describe, expect, it } from 'vitest';

import {
  ArchiveImportError,
  NATIVE_PROFILE,
  RENDER_PROFILES,
  SOURCE_ROWS,
  glyphKey,
  importArchiveImage,
  profileFor,
  profileHeight,
  profileWidth,
  type SourcePixels,
} from './archiveImport';
import { SAMPLES } from './archiveImport.fixtures';

/**
 * These tests are written against the archive's 520x400 renderer — the
 * reference size, and the one both sample pages use. The other profiles get
 * their own checks below.
 */
const CELL_WIDTH = NATIVE_PROFILE.cellWidth;
const CELL_HEIGHT = NATIVE_PROFILE.cellHeight;
const SOURCE_WIDTH = profileWidth(NATIVE_PROFILE);
const SOURCE_HEIGHT = profileHeight(NATIVE_PROFILE);
const GLYPH_ATLAS = NATIVE_PROFILE.atlas;
import {
  COLS,
  ROWS,
  TELETEXT_COLORS,
  TELETEXT_COLOR_HEX,
  indexAt,
  isDoubleHeightShadow,
  isEffectiveDoubleHeight,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';

function rgb(color: TeletextColor): [number, number, number] {
  const hex = TELETEXT_COLOR_HEX[color];
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Expand a fixture's run-length encoding into an RGBA buffer. */
function decodeFixture(rle: string, scale = 1): SourcePixels {
  const width = SOURCE_WIDTH * scale;
  const height = SOURCE_HEIGHT * scale;
  const data = new Uint8ClampedArray(width * height * 4);

  let pixel = 0;
  for (const run of rle.split(',')) {
    const color = TELETEXT_COLORS[Number(run[0])];
    const count = parseInt(run.slice(1), 36);
    const [r, g, b] = rgb(color);
    for (let i = 0; i < count; i++, pixel++) {
      const x = pixel % SOURCE_WIDTH;
      const y = Math.floor(pixel / SOURCE_WIDTH);
      // Paint the whole scale x scale block, so an upscaled fixture is exactly
      // what a nearest-neighbour enlargement of the render would look like.
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = ((y * scale + dy) * width + x * scale + dx) * 4;
          data[offset] = r;
          data[offset + 1] = g;
          data[offset + 2] = b;
          data[offset + 3] = 255;
        }
      }
    }
  }
  expect(pixel).toBe(SOURCE_WIDTH * SOURCE_HEIGHT);
  return { width, height, data };
}

/** Render a page back to the one-character-per-cell form the fixtures use. */
function pageText(page: TeletextPage): string[] {
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    let line = '';
    for (let col = 0; col < COLS; col++) {
      const cell = page[indexAt(col, row)];
      line += cell.graphics != null ? '#' : cell.char;
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/** A blank source image, every pixel `color`. */
function blankSource(color: TeletextColor = 'black'): {
  pixels: SourcePixels;
  set: (x: number, y: number, color: TeletextColor) => void;
} {
  const data = new Uint8ClampedArray(SOURCE_WIDTH * SOURCE_HEIGHT * 4);
  const [r, g, b] = rgb(color);
  for (let i = 0; i < SOURCE_WIDTH * SOURCE_HEIGHT; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return {
    pixels: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, data },
    set(x, y, next) {
      const [nr, ng, nb] = rgb(next);
      const offset = (y * SOURCE_WIDTH + x) * 4;
      data[offset] = nr;
      data[offset + 1] = ng;
      data[offset + 2] = nb;
    },
  };
}

/** Sixel sub-cell bounds, duplicated here so a change in the module is a test failure. */
const SIXEL_X = [0, 6, CELL_WIDTH];
const SIXEL_Y = [0, 5, 11, CELL_HEIGHT];

/** Paint a sixel pattern into the cell at (`col`, `row`) of a source image. */
function paintSixel(
  set: (x: number, y: number, color: TeletextColor) => void,
  col: number,
  row: number,
  pattern: number,
  fg: TeletextColor,
  bg: TeletextColor,
): void {
  for (let part = 0; part < 6; part++) {
    const sc = part % 2;
    const sr = Math.floor(part / 2);
    const color = (pattern >> part) & 1 ? fg : bg;
    for (let y = SIXEL_Y[sr]; y < SIXEL_Y[sr + 1]; y++) {
      for (let x = SIXEL_X[sc]; x < SIXEL_X[sc + 1]; x++) {
        set(col * CELL_WIDTH + x, row * CELL_HEIGHT + y, color);
      }
    }
  }
}

/** Separated-graphics extents, duplicated so a change in the module fails here. */
const SEPARATED_X = [
  [1, 6],
  [7, 12],
];
const SEPARATED_Y = [
  [0, 4],
  [5, 10],
  [11, 15],
];

/** Paint a separated-graphics pattern: the same blocks, each inset by a gap. */
function paintSeparated(
  set: (x: number, y: number, color: TeletextColor) => void,
  col: number,
  row: number,
  pattern: number,
  fg: TeletextColor,
  bg: TeletextColor,
): void {
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      set(col * CELL_WIDTH + x, row * CELL_HEIGHT + y, bg);
    }
  }
  for (let part = 0; part < 6; part++) {
    if (((pattern >> part) & 1) === 0) continue;
    const [x0, x1] = SEPARATED_X[part % 2];
    const [y0, y1] = SEPARATED_Y[Math.floor(part / 2)];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        set(col * CELL_WIDTH + x, row * CELL_HEIGHT + y, fg);
      }
    }
  }
}

/** The atlas key whose stencil draws `char`. */
function keyFor(char: string): string {
  const key = Object.keys(GLYPH_ATLAS).find((k) => GLYPH_ATLAS[k] === char);
  if (key == null) throw new Error(`no atlas entry for ${char}`);
  return key;
}

/**
 * Paint `char` at double height across the cells at (`col`, `row`) and the one
 * below, the way the renderer does it: every source row drawn twice, so the
 * 16-row stencil becomes 32 rows spanning two cells.
 */
function paintDoubleHeight(
  set: (x: number, y: number, color: TeletextColor) => void,
  col: number,
  row: number,
  char: string,
  fg: TeletextColor,
  bg: TeletextColor,
): void {
  const key = keyFor(char);
  for (let source = 0; source < CELL_HEIGHT; source++) {
    const bits = parseInt(key.slice(source * 4, source * 4 + 4), 16);
    for (let copy = 0; copy < 2; copy++) {
      const target = source * 2 + copy;
      const y = row * CELL_HEIGHT + target;
      for (let x = 0; x < CELL_WIDTH; x++) {
        const ink = (bits >> (CELL_WIDTH - 1 - x)) & 1;
        set(col * CELL_WIDTH + x, y, ink ? fg : bg);
      }
    }
  }
}

/** Paint the atlas stencil for `char` into the cell at (`col`, `row`). */
function paintChar(
  set: (x: number, y: number, color: TeletextColor) => void,
  col: number,
  row: number,
  char: string,
  fg: TeletextColor,
  bg: TeletextColor,
): void {
  const key = Object.keys(GLYPH_ATLAS).find((k) => GLYPH_ATLAS[k] === char);
  if (key == null) throw new Error(`no atlas entry for ${char}`);
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const bits = parseInt(key.slice(y * 4, y * 4 + 4), 16);
    for (let x = 0; x < CELL_WIDTH; x++) {
      const ink = (bits >> (CELL_WIDTH - 1 - x)) & 1;
      set(col * CELL_WIDTH + x, row * CELL_HEIGHT + y, ink ? fg : bg);
    }
  }
}

describe('glyphKey', () => {
  it('is the inverse of the atlas key format', () => {
    const key = Object.keys(GLYPH_ATLAS)[0];
    const bitmap: boolean[][] = [];
    for (let y = 0; y < CELL_HEIGHT; y++) {
      const bits = parseInt(key.slice(y * 4, y * 4 + 4), 16);
      bitmap.push(
        Array.from({ length: CELL_WIDTH }, (_, x) => ((bits >> (CELL_WIDTH - 1 - x)) & 1) === 1),
      );
    }
    expect(glyphKey(bitmap)).toBe(key);
  });
});

describe('profileFor', () => {
  const empty = new Uint8ClampedArray(0);

  it('recognises each of the archive\u2019s render sizes', () => {
    for (const profile of RENDER_PROFILES) {
      const match = profileFor({
        width: profileWidth(profile),
        height: profileHeight(profile),
        data: empty,
      });
      expect(match).toEqual({ profile, scale: 1 });
    }
  });

  it('accepts whole multiples of a render size', () => {
    expect(profileFor({ width: 1040, height: 800, data: empty })).toEqual({
      profile: NATIVE_PROFILE,
      scale: 2,
    });
    expect(profileFor({ width: 1560, height: 1200, data: empty })?.scale).toBe(3);
  });

  it('rejects sizes that are not a render, or scale unevenly', () => {
    expect(profileFor({ width: 520, height: 800, data: empty })).toBeNull();
    expect(profileFor({ width: 780, height: 600, data: empty })).toBeNull();
    expect(profileFor({ width: 512, height: 400, data: empty })).toBeNull();
    expect(profileFor({ width: 260, height: 200, data: empty })).toBeNull();
  });

  it('gives every profile 40 columns, its own row count, and a distinct native size', () => {
    const sizes = new Set<string>();
    for (const profile of RENDER_PROFILES) {
      expect(profileWidth(profile)).toBe(COLS * profile.cellWidth);
      expect(profileHeight(profile)).toBe(profile.sourceRows * profile.cellHeight);
      expect(profile.sixelX[2]).toBe(profile.cellWidth);
      expect(profile.sixelY[3]).toBe(profile.cellHeight);
      // Either the renderer emits a header row we drop, or it emits exactly our
      // own row count and we drop nothing. Nothing else is meaningful.
      expect([ROWS, ROWS + 1]).toContain(profile.sourceRows);
      sizes.add(`${profileWidth(profile)}x${profileHeight(profile)}`);
    }
    expect(sizes.size).toBe(RENDER_PROFILES.length);
    expect(SOURCE_ROWS).toBe(ROWS + 1);
  });

  it('drops a row only for renderers that have one to spare', () => {
    // RTP renders 25 rows and gives one up; SIC renders 24 and keeps them all.
    // This used to be a global constant asserting 25 everywhere, which silently
    // made SIC's pages undecodable.
    for (const profile of RENDER_PROFILES) {
      const rtp = ['520x400', '400x300', '320x250'].includes(profile.name);
      expect(profile.sourceRows).toBe(rtp ? ROWS + 1 : ROWS);
    }
  });
});

describe.each(RENDER_PROFILES)('glyph atlas \u2014 $name', (profile) => {
  const digits = profile.cellHeight * 4;

  it('has a well-formed key for every entry', () => {
    for (const key of Object.keys(profile.atlas)) {
      expect(key).toMatch(new RegExp(`^[0-9a-f]{${digits}}$`));
      for (let y = 0; y < profile.cellHeight; y++) {
        expect(parseInt(key.slice(y * 4, y * 4 + 4), 16)).toBeLessThan(1 << profile.cellWidth);
      }
    }
  });

  it('maps each stencil to exactly one character', () => {
    const chars = Object.values(profile.atlas);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('covers the printable ASCII the archive uses', () => {
    const chars = new Set(Object.values(profile.atlas));
    // A character the renderer draws with another character's exact pixels has
    // no stencil of its own and never can: SIC's fonts draw `0` and `O` the
    // same, so the atlas holds one of them and `resolveHomoglyphs` recovers the
    // other from context at decode time. Counting it as covered is the point —
    // the alternative would be an atlas entry that can never be reached.
    for (const [letter, digit] of Object.entries(profile.homoglyphDigits ?? {})) {
      if (chars.has(letter)) chars.add(digit);
      if (chars.has(digit)) chars.add(letter);
    }
    for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
      expect(chars.has(char), `${profile.name} atlas is missing ${char}`).toBe(true);
    }
  });
});

/**
 * Dominant colours each sample should decode to, read off the images by eye:
 * 163 is yellow-on-blue with a white mascot, 198 is a black-and-blue index on
 * white. Sixel sub-cells are unequal sizes, so which of a graphics cell's two
 * colours is "the background" is not decidable from area alone — get that
 * backwards and the page still *looks* right but every colour is inverted,
 * which is exactly what these numbers catch.
 */
const EXPECTED_COLORS: Record<string, { background: TeletextColor; graphicsFg: TeletextColor }> = {
  '163-01.gif': { background: 'blue', graphicsFg: 'white' },
  '198-01.gif': { background: 'white', graphicsFg: 'blue' },
};

/** The most frequent key of a tally, i.e. the colour used by the most cells. */
function dominant(counts: Map<TeletextColor, number>): TeletextColor {
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

describe.each(SAMPLES)('importArchiveImage — $name', (sample) => {
  it('decodes to the expected page', () => {
    const result = importArchiveImage(decodeFixture(sample.rle));
    expect(pageText(result.page)).toEqual([...sample.text]);
  });

  it('recognises every character on the page', () => {
    const result = importArchiveImage(decodeFixture(sample.rle));
    expect(result.unknownGlyphs).toEqual([]);
  });

  it('reads every pixel as an exact palette colour', () => {
    expect(importArchiveImage(decodeFixture(sample.rle)).snappedPixels).toBe(0);
  });

  it('drops the blank trailing row, leaving every other row where it rendered', () => {
    const result = importArchiveImage(decodeFixture(sample.rle));
    expect(result.droppedRow).toBe('last');
    expect(result.droppedRowHadContent).toBe(false);
  });

  it('decodes an upscaled copy identically', () => {
    const native = importArchiveImage(decodeFixture(sample.rle));
    const doubled = importArchiveImage(decodeFixture(sample.rle, 2));
    expect(doubled.page).toEqual(native.page);
  });

  it('reads the page background and graphics colours the right way round', () => {
    const { page } = importArchiveImage(decodeFixture(sample.rle));
    const backgrounds = new Map<TeletextColor, number>();
    const graphicsFg = new Map<TeletextColor, number>();
    for (const cell of page) {
      backgrounds.set(cell.bg, (backgrounds.get(cell.bg) ?? 0) + 1);
      if (cell.graphics != null) {
        graphicsFg.set(cell.fg, (graphicsFg.get(cell.fg) ?? 0) + 1);
      }
    }
    expect({
      background: dominant(backgrounds),
      graphicsFg: dominant(graphicsFg),
    }).toEqual(EXPECTED_COLORS[sample.name]);
  });

  it('produces a page of exactly the right size, with valid colours', () => {
    const { page } = importArchiveImage(decodeFixture(sample.rle));
    expect(page).toHaveLength(COLS * ROWS);
    for (const cell of page) {
      expect(TELETEXT_COLORS).toContain(cell.fg);
      expect(TELETEXT_COLORS).toContain(cell.bg);
      if (cell.graphics != null) {
        expect(cell.graphics).toBeGreaterThanOrEqual(0);
        expect(cell.graphics).toBeLessThanOrEqual(63);
      }
    }
  });
});

describe('importArchiveImage — geometry', () => {
  it('rejects an image that is not an archive render', () => {
    // 400x300 IS one of the render sizes, so the odd size here is deliberate.
    const data = new Uint8ClampedArray(400 * 301 * 4);
    expect(() => importArchiveImage({ width: 400, height: 301, data })).toThrow(
      ArchiveImportError,
    );
    expect(() => importArchiveImage({ width: 333, height: 222, data })).toThrow(
      ArchiveImportError,
    );
  });

  it('reads every sixel pattern back exactly', () => {
    // Red throughout, so every row's prevailing background is unambiguous —
    // sixel sub-cells are unequal sizes, so on a bare page a pattern like
    // 0b001011 covers more of its cell in foreground than in background.
    const { pixels, set } = blankSource('red');
    // Row 1 onwards: the trailing row is dropped, so page row == render row.
    for (let pattern = 0; pattern < 64; pattern++) {
      paintSixel(set, pattern % COLS, 1 + Math.floor(pattern / COLS), pattern, 'cyan', 'red');
    }
    const { page } = importArchiveImage(pixels);
    for (let pattern = 0; pattern < 64; pattern++) {
      const cell = page[indexAt(pattern % COLS, 1 + Math.floor(pattern / COLS))];
      if (pattern === 0) {
        // No cyan at all: a flat red cell, which is a space, not empty graphics.
        expect(cell).toMatchObject({ char: ' ', bg: 'red', graphics: null });
        continue;
      }
      if (pattern === 63) {
        // Entirely cyan, likewise indistinguishable from a flat cell.
        expect(cell).toMatchObject({ char: ' ', bg: 'cyan', graphics: null });
        continue;
      }
      expect(cell.graphics).toBe(pattern);
      expect(cell.fg).toBe('cyan');
      expect(cell.bg).toBe('red');
    }
  });

  it('reads back every character in the atlas, in both polarities', () => {
    for (const [fg, bg] of [
      ['white', 'blue'],
      ['blue', 'white'],
    ] as const) {
      const { pixels, set } = blankSource(bg);
      const chars = Object.values(GLYPH_ATLAS);
      chars.forEach((char, i) => {
        paintChar(set, i % COLS, 1 + Math.floor(i / COLS), char, fg, bg);
      });
      const { page, unknownGlyphs } = importArchiveImage(pixels);
      expect(unknownGlyphs).toEqual([]);
      chars.forEach((char, i) => {
        const cell = page[indexAt(i % COLS, 1 + Math.floor(i / COLS))];
        expect({ char: cell.char, fg: cell.fg, bg: cell.bg }).toEqual({ char, fg, bg });
      });
    }
  });

  it('reports an unrecognised stencil instead of guessing at it', () => {
    const { pixels, set } = blankSource('black');
    // A shape that is neither flat sixels nor an atlas entry: a diagonal.
    for (const col of [3, 9]) {
      for (let i = 0; i < CELL_HEIGHT; i++) {
        set(col * CELL_WIDTH + (i % CELL_WIDTH), CELL_HEIGHT + i, 'yellow');
      }
    }
    const { page, unknownGlyphs } = importArchiveImage(pixels);
    expect(unknownGlyphs).toHaveLength(1);
    expect(unknownGlyphs[0].cells).toEqual([indexAt(3, 1), indexAt(9, 1)]);
    expect(unknownGlyphs[0].key).toMatch(/^[0-9a-f]{64}$/);
    // Left as its background rather than filled with a wrong character.
    expect(page[indexAt(3, 1)]).toMatchObject({ char: ' ', graphics: null });
  });

  it('accepts a character taught through the atlas argument', () => {
    const { pixels, set } = blankSource('black');
    for (let i = 0; i < CELL_HEIGHT; i++) {
      set(3 * CELL_WIDTH + (i % CELL_WIDTH), CELL_HEIGHT + i, 'yellow');
    }
    const { unknownGlyphs } = importArchiveImage(pixels);
    const taught = { ...GLYPH_ATLAS, [unknownGlyphs[0].key]: 'Z' };

    const { page, unknownGlyphs: none } = importArchiveImage(pixels, taught);
    expect(none).toEqual([]);
    expect(page[indexAt(3, 1)]).toMatchObject({ char: 'Z', fg: 'yellow', bg: 'black' });
  });

  it('keeps the header row when it has content and the last row is blank', () => {
    const { pixels, set } = blankSource('black');
    paintChar(set, 0, 0, 'A', 'white', 'black');
    const { page, droppedRow } = importArchiveImage(pixels);
    expect(droppedRow).toBe('last');
    expect(page[indexAt(0, 0)].char).toBe('A');
  });

  it('shifts up instead when the last row has content and the header does not', () => {
    const { pixels, set } = blankSource('black');
    paintChar(set, 0, SOURCE_ROWS - 1, 'A', 'white', 'black');
    const { page, droppedRow } = importArchiveImage(pixels);
    expect(droppedRow).toBe('first');
    // The render's last row survives, as the last row of the page.
    expect(page[indexAt(0, ROWS - 1)].char).toBe('A');
  });

  it('reads separated graphics back as the equivalent solid pattern', () => {
    // Teletext's separated mode draws the same six blocks with a gap around
    // each. Our pages have no separated flag, so the pattern and colours must
    // survive even though the gaps cannot.
    const { pixels, set } = blankSource('blue');
    for (let pattern = 1; pattern < 63; pattern++) {
      paintSeparated(set, pattern % COLS, 1 + Math.floor(pattern / COLS), pattern, 'white', 'blue');
    }
    const { page, unknownGlyphs } = importArchiveImage(pixels);
    expect(unknownGlyphs).toEqual([]);
    for (let pattern = 1; pattern < 63; pattern++) {
      const cell = page[indexAt(pattern % COLS, 1 + Math.floor(pattern / COLS))];
      expect({ pattern: cell.graphics, fg: cell.fg, bg: cell.bg }).toEqual({
        pattern,
        fg: 'white',
        bg: 'blue',
      });
    }
  });

  it('reads a double-height line as one tall cell over a covered one', () => {
    const { pixels, set } = blankSource('black');
    const word = 'RTP';
    [...word].forEach((char, i) => paintDoubleHeight(set, i, 2, char, 'yellow', 'black'));

    const { page, unknownGlyphs } = importArchiveImage(pixels);
    expect(unknownGlyphs).toEqual([]);
    [...word].forEach((char, i) => {
      expect(page[indexAt(i, 2)]).toMatchObject({ char, fg: 'yellow', doubleHeight: true });
      // The row below carries nothing of its own: the tall cell spans it.
      expect(page[indexAt(i, 3)]).toMatchObject({ char: ' ', graphics: null });
      expect(page[indexAt(i, 3)].doubleHeight).toBeFalsy();
    });
    // And our grid agrees the pair renders as one double-height box.
    expect(isEffectiveDoubleHeight(page, indexAt(0, 2))).toBe(true);
    expect(isDoubleHeightShadow(page, indexAt(0, 3))).toBe(true);
  });

  it('reads a double-height character whose top half is blank', () => {
    // A comma has no ink above the baseline, so its upper cell is entirely
    // background — the pair still has to be recognised as one character.
    const { pixels, set } = blankSource('black');
    paintDoubleHeight(set, 4, 2, ',', 'white', 'black');
    const { page, unknownGlyphs } = importArchiveImage(pixels);
    expect(unknownGlyphs).toEqual([]);
    expect(page[indexAt(4, 2)]).toMatchObject({ char: ',', doubleHeight: true });
  });

  it('does not invent a double-height character out of two normal cells', () => {
    // Two ordinary single-height letters stacked must stay two letters.
    const { pixels, set } = blankSource('black');
    paintChar(set, 0, 2, 'o', 'white', 'black');
    paintChar(set, 0, 3, 'o', 'white', 'black');
    const { page } = importArchiveImage(pixels);
    expect(page[indexAt(0, 2)]).toMatchObject({ char: 'o' });
    expect(page[indexAt(0, 2)].doubleHeight).toBeFalsy();
    expect(page[indexAt(0, 3)]).toMatchObject({ char: 'o' });
  });

  it('snaps off-palette pixels and counts them', () => {
    const { pixels } = blankSource('black');
    const data = pixels.data as Uint8ClampedArray;
    // One near-white pixel: close enough to snap, far enough to be counted.
    data[0] = 250;
    data[1] = 250;
    data[2] = 250;
    const result = importArchiveImage(pixels);
    expect(result.snappedPixels).toBe(1);
  });
});
