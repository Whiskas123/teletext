/**
 * What the editor's bulk tools do to a page, as data.
 *
 * Pasting, moving a selection, shifting rows, lines, boxes and fills all come
 * down to "these cells become these values". Everything here works that out
 * from a page and returns the cells to write, by index; the editor writes them
 * through its one cell writer, so each is an undoable step like any other.
 *
 * The header row (row 0) is not a row anyone edits, so nothing here reads from
 * it or returns a write to it.
 */

import { sameCell } from './pageReuse';
import {
  COLS,
  ROWS,
  SIXEL_COLS,
  SIXEL_ROWS,
  TOTAL_CELLS,
  setSixelBit,
  sixelBit,
  type Cell,
  type SixelColors,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';

/** The first row a cell can be edited on. */
export const FIRST_ROW = 1;

/** Cells to write, by index. */
export type Writes = Map<number, Cell>;

export const emptyCell = (): Cell => ({ char: ' ', fg: 'white', bg: 'black', graphics: null });

const isBlank = (cell: Cell) => cell.char === ' ' && cell.graphics == null;

/* ── text ─────────────────────────────────────────────────────────────────── */

/**
 * Where each character of a pasted text lands, starting at `start`.
 *
 * A new line returns to the column the paste began in rather than to column 0,
 * and so does a line too long for the row: text pasted into the middle of a
 * page keeps the shape of a block. `rowStep` is 2 while typing double height.
 * What does not fit on the page is dropped.
 */
export function layoutText(
  text: string,
  start: number,
  rowStep = 1,
): { index: number; char: string }[] {
  const startCol = start % COLS;
  let row = Math.max(FIRST_ROW, Math.floor(start / COLS));
  let col = startCol;
  const placed: { index: number; char: string }[] = [];
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    text.replace(/\r\n?/g, '\n').normalize('NFC'),
  );
  for (const { segment } of segments) {
    if (segment === '\n') {
      row += rowStep;
      col = startCol;
      continue;
    }
    const char = segment === '\t' ? ' ' : segment;
    if (char < ' ') continue;
    if (col >= COLS) {
      row += rowStep;
      col = startCol;
    }
    if (row >= ROWS) break;
    placed.push({ index: row * COLS + col, char });
    col += 1;
  }
  return placed;
}

/** Home: the first column of the cursor's row. */
export function lineStart(index: number): number {
  return Math.floor(index / COLS) * COLS;
}

/** End: just past the last thing on the cursor's row (its last column if full). */
export function lineEnd(page: TeletextPage, index: number): number {
  const start = lineStart(index);
  for (let col = COLS - 1; col >= 0; col -= 1) {
    if (!isBlank(page[start + col])) return start + Math.min(col + 1, COLS - 1);
  }
  return start;
}

/** The start of the next word (`dir` 1) or of this or the previous one (-1). */
export function wordJump(page: TeletextPage, index: number, dir: 1 | -1): number {
  const first = FIRST_ROW * COLS;
  const last = TOTAL_CELLS - 1;
  let i = index;
  if (dir === 1) {
    while (i < last && !isBlank(page[i])) i += 1;
    while (i < last && isBlank(page[i])) i += 1;
    return i;
  }
  while (i > first && isBlank(page[i - 1])) i -= 1;
  while (i > first && !isBlank(page[i - 1])) i -= 1;
  return i;
}

/* ── rectangles ───────────────────────────────────────────────────────────── */

export interface Rect {
  col: number;
  row: number;
  width: number;
  height: number;
}

/** The rectangle between two cells, kept off the header row. */
export function rectFromCorners(a: number, b: number): Rect {
  const cols = [a % COLS, b % COLS];
  const rows = [Math.floor(a / COLS), Math.floor(b / COLS)].map((r) => Math.max(FIRST_ROW, r));
  const col = Math.min(...cols);
  const row = Math.min(...rows);
  return { col, row, width: Math.max(...cols) - col + 1, height: Math.max(...rows) - row + 1 };
}

export function inRect(rect: Rect, index: number): boolean {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return (
    col >= rect.col && col < rect.col + rect.width && row >= rect.row && row < rect.row + rect.height
  );
}

/** Every cell of a rectangle, row by row. */
export function rectIndexes(rect: Rect): number[] {
  const indexes: number[] = [];
  for (let row = rect.row; row < rect.row + rect.height; row += 1) {
    for (let col = rect.col; col < rect.col + rect.width; col += 1) indexes.push(row * COLS + col);
  }
  return indexes;
}

/** `rect` moved by a delta, stopped at the page's edges. */
export function offsetRect(rect: Rect, dCol: number, dRow: number): Rect {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    ...rect,
    col: clamp(rect.col + dCol, 0, COLS - rect.width),
    row: clamp(rect.row + dRow, FIRST_ROW, ROWS - rect.height),
  };
}

/** A copied block of cells: what the editor's clipboard holds. */
export interface CellBlock {
  width: number;
  height: number;
  /** Row by row, `width * height` of them. */
  cells: Cell[];
}

export function copyRect(page: TeletextPage, rect: Rect): CellBlock {
  return {
    width: rect.width,
    height: rect.height,
    cells: rectIndexes(rect).map((index) => ({ ...page[index] })),
  };
}

/** The block as plain text, for whatever else is pasted into. */
export function blockText(block: CellBlock): string {
  const lines: string[] = [];
  for (let row = 0; row < block.height; row += 1) {
    lines.push(
      block.cells
        .slice(row * block.width, (row + 1) * block.width)
        .map((cell) => (cell.graphics == null ? cell.char : ' '))
        .join('')
        .trimEnd(),
    );
  }
  return lines.join('\n');
}

/** A block put down with its top-left corner at `at`; what falls off is dropped. */
export function pasteBlock(block: CellBlock, at: number): { writes: Writes; rect: Rect } {
  const col = at % COLS;
  const row = Math.max(FIRST_ROW, Math.floor(at / COLS));
  const writes: Writes = new Map();
  for (let r = 0; r < block.height && row + r < ROWS; r += 1) {
    for (let c = 0; c < block.width && col + c < COLS; c += 1) {
      const cell = block.cells[r * block.width + c];
      if (cell != null) writes.set((row + r) * COLS + col + c, cell);
    }
  }
  return {
    writes,
    rect: {
      col,
      row,
      width: Math.min(block.width, COLS - col),
      height: Math.min(block.height, ROWS - row),
    },
  };
}

/**
 * Move a rectangle of cells to where `to` (already inside the page, see
 * {@link offsetRect}) says, leaving empty cells behind — or leaving the
 * original where it was, when copying.
 */
export function moveRect(page: TeletextPage, from: Rect, to: Rect, copy: boolean): Writes {
  const writes: Writes = new Map();
  if (!copy) for (const index of rectIndexes(from)) writes.set(index, emptyCell());
  const block = copyRect(page, from);
  for (const [index, cell] of pasteBlock(block, to.row * COLS + to.col).writes) {
    writes.set(index, cell);
  }
  return dropUnchanged(page, writes);
}

function dropUnchanged(page: TeletextPage, writes: Writes): Writes {
  for (const [index, cell] of writes) if (sameCell(page[index], cell)) writes.delete(index);
  return writes;
}

/* ── the brush, one cell at a time ────────────────────────────────────────── */

/** A cell stamped by the block brush. */
export function blockCell(cell: Cell, pattern: number, colors: SixelColors): Cell {
  return {
    ...cell,
    char: ' ',
    fg: 'white',
    bg: 'black',
    graphics: pattern,
    graphicsColors: [...colors] as unknown as SixelColors,
  };
}

/** A cell rubbed out by the block brush: `cell` itself when already empty. */
export function erasedCell(cell: Cell): Cell {
  return cell.graphics != null || cell.char !== ' ' || cell.bg !== 'black' ? emptyCell() : cell;
}

/**
 * A cell with one sixth painted (or erased), the other five left alone.
 *
 * A cell that was showing text becomes a graphics cell with just this sixth
 * lit; erasing the last lit sixth returns it to a plain empty cell, so it does
 * not count as page content. Returns `cell` itself when nothing would change.
 */
export function withSixelPart(
  cell: Cell,
  part: number,
  color: TeletextColor,
  erase: boolean,
): Cell {
  const base = typeof cell.graphics === 'number' ? cell.graphics & 0x3f : 0;
  const next = setSixelBit(base, part, !erase);
  const unchanged =
    next === base &&
    cell.char === ' ' &&
    (erase || cell.graphicsColors?.[part] === color) &&
    (next !== 0 || cell.graphics == null);
  if (unchanged) return cell;
  if (next === 0) {
    return { ...cell, char: ' ', fg: 'white', bg: 'black', graphics: null, graphicsColors: undefined };
  }
  const colors = [
    ...(cell.graphicsColors ?? (Array(6).fill('black') as TeletextColor[])),
  ] as TeletextColor[];
  if (!erase) colors[part] = color;
  return {
    ...cell,
    char: ' ',
    fg: 'white',
    bg: 'black',
    graphics: next,
    graphicsColors: colors as unknown as SixelColors,
  };
}

/* ── shapes ───────────────────────────────────────────────────────────────── */

/** A place the brush can touch: a cell, and the sixth of it (0 for a cell brush). */
export interface Point {
  index: number;
  part: number;
}

/** A point as (x, y) in cells, or in sixths when `pixel`. */
function toXY(point: Point, pixel: boolean): [number, number] {
  const col = point.index % COLS;
  const row = Math.floor(point.index / COLS);
  if (!pixel) return [col, row];
  return [
    col * SIXEL_COLS + (point.part % SIXEL_COLS),
    row * SIXEL_ROWS + Math.floor(point.part / SIXEL_COLS),
  ];
}

/** The reverse of {@link toXY}; null off the page or on the header row. */
function fromXY(x: number, y: number, pixel: boolean): Point | null {
  const col = pixel ? Math.floor(x / SIXEL_COLS) : x;
  const row = pixel ? Math.floor(y / SIXEL_ROWS) : y;
  if (col < 0 || col >= COLS || row < FIRST_ROW || row >= ROWS) return null;
  return {
    index: row * COLS + col,
    part: pixel ? (y % SIXEL_ROWS) * SIXEL_COLS + (x % SIXEL_COLS) : 0,
  };
}

function collect(xy: [number, number][], pixel: boolean): Point[] {
  return xy.map(([x, y]) => fromXY(x, y, pixel)).filter((p): p is Point => p != null);
}

/** Every point on the straight line between two, both ends included (Bresenham). */
export function linePoints(from: Point, to: Point, pixel: boolean): Point[] {
  let [x, y] = toXY(from, pixel);
  const [x1, y1] = toXY(to, pixel);
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let error = dx - dy;
  const xy: [number, number][] = [];
  for (let guard = 0; guard <= dx + dy; guard += 1) {
    xy.push([x, y]);
    if (x === x1 && y === y1) break;
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }
  }
  return collect(xy, pixel);
}

/** Every point of the filled box between two corners. */
export function boxPoints(from: Point, to: Point, pixel: boolean): Point[] {
  const [x0, y0] = toXY(from, pixel);
  const [x1, y1] = toXY(to, pixel);
  const xy: [number, number][] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) xy.push([x, y]);
  }
  return collect(xy, pixel);
}

/**
 * The points a fill poured in at `start` reaches: everything joined to it,
 * edge to edge, that looks the same.
 *
 * For a cell brush "the same" is the whole cell. For a pixel brush it is the
 * sixth: lit in one colour, or unlit — and a cell holding a letter is a wall,
 * since filling through it would rub the letter out.
 */
export function floodPoints(page: TeletextPage, start: Point, pixel: boolean): Point[] {
  const width = pixel ? COLS * SIXEL_COLS : COLS;
  const height = pixel ? ROWS * SIXEL_ROWS : ROWS;
  const look = (point: Point): string | Cell => {
    const cell = page[point.index];
    if (!pixel) return cell;
    if (cell.graphics == null) return cell.char === ' ' ? 'unlit' : `letter${point.index}`;
    return sixelBit(cell.graphics, point.part)
      ? (cell.graphicsColors?.[point.part] ?? cell.fg)
      : 'unlit';
  };
  const same = (a: string | Cell, b: string | Cell) =>
    typeof a === 'string' || typeof b === 'string' ? a === b : sameCell(a, b);

  const wanted = look(start);
  const seen = new Set<number>();
  const found: Point[] = [];
  const queue: [number, number][] = [toXY(start, pixel)];
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height || seen.has(y * width + x)) continue;
    seen.add(y * width + x);
    const point = fromXY(x, y, pixel);
    if (point == null || !same(look(point), wanted)) continue;
    found.push(point);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return found;
}

/**
 * Run the brush over a set of points and say which cells changed.
 *
 * Accumulates, so several sixths of one cell painted in one shape all land.
 */
export function paintPoints(
  page: TeletextPage,
  points: readonly Point[],
  paint: (cell: Cell, part: number) => Cell,
): Writes {
  const writes: Writes = new Map();
  for (const { index, part } of points) {
    const cell = writes.get(index) ?? page[index];
    const next = paint(cell, part);
    if (next !== cell) writes.set(index, next);
  }
  return writes;
}
