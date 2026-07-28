/**
 * Teletext color names (7 colors + black per spec).
 */
export const TELETEXT_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const;

export type TeletextColor = (typeof TELETEXT_COLORS)[number];

export const COLS = 40;
export const ROWS = 24;
export const TOTAL_CELLS = COLS * ROWS;

/**
 * Sixel pattern: 0-63. Bits 0-5 map to a 2×3 grid in **row-major** order, the
 * same order the renderer lays the sub-cells out (see `SixelBlock` in
 * `components/TeletextGrid` and `drawSixel` in `utils/exportPng.ts`):
 *
 *     bit 0 = top-left      bit 1 = top-right
 *     bit 2 = mid-left      bit 3 = mid-right
 *     bit 4 = bottom-left   bit 5 = bottom-right
 *
 * i.e. `col = i % 2`, `row = Math.floor(i / 2)`.
 */
export const SIXEL_BITS = 6;
export const SIXEL_MAX = 63;

/** Number of sixel sub-cell columns / rows within one character cell. */
export const SIXEL_COLS = 2;
export const SIXEL_ROWS = 3;

/** One color per sixel position (0=top-left ... 5=bottom-right, row-major). Used when graphics is set. */
export type SixelColors = readonly [
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
];

/** Default: one color per part so motif patterns are distinguishable from the start. */
export const DEFAULT_SIXEL_COLORS: SixelColors = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
];

/**
 * Motif pattern: slots[i] = which color slot (0-based) position i uses.
 * Same pattern can be used with different color palettes.
 */
export type MotifSlotPattern = readonly [number, number, number, number, number, number];

export const MOTIF_PATTERNS: readonly { name: string; slots: MotifSlotPattern }[] = [
  { name: 'Solid', slots: [0, 0, 0, 0, 0, 0] },     // 1 slot
  { name: 'Checker', slots: [0, 1, 0, 1, 0, 1] },   // 2 slots (alternating)
  { name: 'Split', slots: [0, 0, 0, 1, 1, 1] },     // 2 slots (left / right)
  { name: 'Corners', slots: [0, 0, 1, 1, 0, 0] },   // 2 slots (corners vs middle)
  { name: 'Custom', slots: [0, 1, 2, 3, 4, 5] },    // 6 slots (each part independent)
];

/** Get number of color slots for a motif pattern. */
export function motifSlotCount(slots: MotifSlotPattern): number {
  return Math.max(...slots) + 1;
}

/** Derive brush colors from slot colors. */
export function brushColorsFromSlots(
  slots: MotifSlotPattern,
  slotColors: readonly TeletextColor[],
): SixelColors {
  return slots.map((s) => slotColors[s] ?? 'white') as unknown as SixelColors;
}

/** Extract slot colors from brush colors (first occurrence per slot). */
export function slotColorsFromBrush(
  slots: MotifSlotPattern,
  brushColors: SixelColors,
): TeletextColor[] {
  const count = motifSlotCount(slots);
  const result: TeletextColor[] = [];
  for (let slot = 0; slot < count; slot++) {
    const idx = slots.indexOf(slot);
    result.push(idx >= 0 ? brushColors[idx] : 'white');
  }
  return result;
}

export interface Cell {
  char: string;
  fg: TeletextColor;
  bg: TeletextColor;
  /** When set (0-63), cell displays as block graphics (sixels) instead of char. */
  graphics?: number | null;
  /** When graphics is set, color for each of the 6 sixel positions (filled parts). Empty parts use bg. */
  graphicsColors?: SixelColors;
  /** When true, cell content blinks (1s on, 1s off). */
  blink?: boolean;
  /**
   * When true, this cell renders at twice the normal row height (a real
   * teletext attribute), visually covering the cell directly below it in the
   * same column. That cell's own content is not rendered while covered — see
   * `SixelBlock`'s sibling render logic in `components/TeletextGrid`. Only
   * takes effect on content rows with a row beneath them (not the header row
   * or the last row); see `MIN_DOUBLE_HEIGHT_ROW` / `MAX_DOUBLE_HEIGHT_ROW`.
   */
  doubleHeight?: boolean;
}

/** First / last content row a cell may set `doubleHeight` on (needs a row below it, and never the header row). */
export const MIN_DOUBLE_HEIGHT_ROW = 1;
export const MAX_DOUBLE_HEIGHT_ROW = ROWS - 2;

export type TeletextPage = Cell[];

function emptyCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

/**
 * Create a new empty teletext page (40×24 grid).
 */
export function createEmptyPage(): TeletextPage {
  return Array.from({ length: TOTAL_CELLS }, () => emptyCell());
}

/**
 * Get cell index from row and column (0-based).
 */
export function indexAt(col: number, row: number): number {
  return row * COLS + col;
}

/**
 * Get row and column from cell index.
 */
export function rowColFromIndex(index: number): { col: number; row: number } {
  return {
    col: index % COLS,
    row: Math.floor(index / COLS),
  };
}

/**
 * Clone a page (deep copy of cells).
 */
export function clonePage(page: TeletextPage): TeletextPage {
  return page.map((c) => ({ ...c }));
}

/**
 * Whether the cell at `index` renders double-height, given its row is within
 * the valid range (see {@link MIN_DOUBLE_HEIGHT_ROW} / {@link MAX_DOUBLE_HEIGHT_ROW}).
 * A row outside that range ignores a stray `doubleHeight: true` rather than
 * spanning into the header row or off the bottom of the page.
 */
export function isEffectiveDoubleHeight(page: TeletextPage, index: number): boolean {
  const cell = page[index];
  if (!cell?.doubleHeight) return false;
  const row = Math.floor(index / COLS);
  return row >= MIN_DOUBLE_HEIGHT_ROW && row <= MAX_DOUBLE_HEIGHT_ROW;
}

/**
 * Whether the cell at `index` is covered by a double-height cell directly
 * above it (same column, previous row) and so should not render its own
 * content — the cell above's box already spans this row.
 */
export function isDoubleHeightShadow(page: TeletextPage, index: number): boolean {
  const row = Math.floor(index / COLS);
  if (row < MIN_DOUBLE_HEIGHT_ROW + 1 || row > MAX_DOUBLE_HEIGHT_ROW + 1) return false;
  return isEffectiveDoubleHeight(page, index - COLS);
}

/**
 * A double-height shadow cell (see {@link isDoubleHeightShadow}) renders
 * nothing of its own — the covering cell's box already spans it — so a cursor
 * has nowhere to show if it lands there. Resolve `index` by continuing in the
 * direction cursor navigation was already moving (`step`, e.g. -1 for
 * ArrowLeft, +COLS for ArrowDown) until it lands on a cell that isn't a
 * shadow.
 *
 * Direction matters: stepping *backward* off a shadow always lands exactly on
 * its covering double-height cell (one row back is where the shadow's owner
 * always is) — so approaching a double-height line from below naturally lands
 * the cursor on the visible double-height cell. Stepping *forward* instead
 * continues past the shadow to the next real row — so typing across a
 * double-height line, or moving down through one, advances beyond it instead
 * of bouncing back to where it started (which would otherwise make ArrowDown
 * from a double-height row look like it does nothing).
 *
 * Total: always returns an in-range index, clamped to `COLS..TOTAL_CELLS - 1`
 * (row 0 is the header), even if every remaining cell in that direction
 * happens to be shadowed. No separate iteration limit is needed: `result`
 * moves strictly in one direction and the in-range check alone bounds it —
 * a fixed limit sized for vertical steps (as few as one hop) would cut off a
 * horizontal walk (`step` of ±1) partway across a fully double-height row,
 * which can take up to `COLS - 1` steps to cross.
 */
export function resolveDoubleHeightCursor(
  page: TeletextPage,
  index: number,
  step: number,
): number {
  let result = index;
  while (result >= COLS && result < TOTAL_CELLS && isDoubleHeightShadow(page, result)) {
    result += step;
  }
  return Math.max(COLS, Math.min(TOTAL_CELLS - 1, result));
}

/** Get whether a sixel pattern has the bit at index i (0=top-left ... 5=bottom-right). */
export function sixelBit(pattern: number, i: number): boolean {
  return ((pattern & 0x3f) >> i) & 1 ? true : false;
}

/**
 * Return `pattern` with the bit at index `i` set (`on`) or cleared, leaving the
 * other five sub-cells untouched. Out-of-range indices return the pattern
 * unchanged so callers can pass a hit-test result without extra guarding.
 */
export function setSixelBit(pattern: number, i: number, on: boolean): number {
  if (!Number.isInteger(i) || i < 0 || i >= SIXEL_BITS) return pattern & 0x3f;
  const mask = 1 << i;
  return (on ? (pattern | mask) : (pattern & ~mask)) & 0x3f;
}

/**
 * Map a point inside a character cell to the sixel sub-cell (0-5) that contains
 * it, using the renderer's row-major 2×3 layout. `x`/`y` are offsets from the
 * cell's top-left corner; the result is clamped to the cell so points on the
 * trailing edge still resolve to the last column/row.
 */
export function sixelPartAt(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const col = Math.min(SIXEL_COLS - 1, Math.max(0, Math.floor((x / width) * SIXEL_COLS)));
  const row = Math.min(SIXEL_ROWS - 1, Math.max(0, Math.floor((y / height) * SIXEL_ROWS)));
  return row * SIXEL_COLS + col;
}
