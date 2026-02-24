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
 * Sixel pattern: 0-63. Bits 0-5 map to 2×3 grid (top-left to bottom-right).
 * Bit 0 = top-left, 1 = mid-left, 2 = bottom-left, 3 = top-right, 4 = mid-right, 5 = bottom-right.
 */
export const SIXEL_BITS = 6;
export const SIXEL_MAX = 63;

/** One color per sixel position (0=top-left ... 5=bottom-right). Used when graphics is set. */
export type SixelColors = readonly [
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
  TeletextColor,
];

export const DEFAULT_SIXEL_COLORS: SixelColors = [
  'white',
  'white',
  'white',
  'white',
  'white',
  'white',
];

/**
 * Motif pattern: slots[i] = which color slot (0-based) position i uses.
 * Same pattern can be used with different color palettes.
 */
export type MotifSlotPattern = readonly [number, number, number, number, number, number];

export const MOTIF_PATTERNS: readonly { name: string; slots: MotifSlotPattern }[] = [
  { name: 'Solid', slots: [0, 0, 0, 0, 0, 0] },       // 1 slot
  { name: 'Checker', slots: [0, 1, 0, 1, 0, 1] },     // 2 slots (alternating)
  { name: 'Split', slots: [0, 0, 0, 1, 1, 1] },       // 2 slots (left / right)
  { name: 'Corners', slots: [0, 0, 1, 1, 0, 0] },     // 2 slots (corners vs middle)
  { name: 'Gradient', slots: [0, 1, 2, 3, 4, 5] },   // 6 slots (each part independent)
  { name: 'Custom', slots: [0, 1, 2, 3, 4, 5] },     // 6 slots (per-part editor)
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
}

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

/** Get whether a sixel pattern has the bit at index i (0=top-left ... 5=bottom-right). */
export function sixelBit(pattern: number, i: number): boolean {
  return ((pattern & 0x3f) >> i) & 1 ? true : false;
}
