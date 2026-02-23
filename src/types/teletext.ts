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

/** Preset motifs for quick one-click selection in brush mode. */
export const PRESET_MOTIFS: readonly { name: string; colors: SixelColors }[] = [
  { name: 'White', colors: ['white', 'white', 'white', 'white', 'white', 'white'] },
  { name: 'Red', colors: ['red', 'red', 'red', 'red', 'red', 'red'] },
  { name: 'Cyan', colors: ['cyan', 'cyan', 'cyan', 'cyan', 'cyan', 'cyan'] },
  { name: 'Yellow', colors: ['yellow', 'yellow', 'yellow', 'yellow', 'yellow', 'yellow'] },
  { name: 'Green', colors: ['green', 'green', 'green', 'green', 'green', 'green'] },
  { name: 'Magenta', colors: ['magenta', 'magenta', 'magenta', 'magenta', 'magenta', 'magenta'] },
  { name: 'Checker', colors: ['white', 'black', 'white', 'black', 'white', 'black'] },
  { name: 'Gradient', colors: ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] },
  { name: 'Split', colors: ['cyan', 'cyan', 'cyan', 'magenta', 'magenta', 'magenta'] },
  { name: 'Corners', colors: ['yellow', 'yellow', 'black', 'black', 'yellow', 'yellow'] },
];

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
