/**
 * Pure page-operation helpers for Collaborative Teletext Rooms.
 *
 * This module is framework-free and side-effect-free so it can be unit- and
 * property-tested without a live playhtml/Yjs connection. It reuses the
 * teletext primitives (`Cell`, `TeletextPage`, `TOTAL_CELLS`) from
 * `src/types/teletext.ts` and the shared collaborative page shapes
 * (`PageCellMap`, `PagesData`) from `src/collab/types.ts`.
 *
 * Requirements covered: 3.4, 3.5, 3.6, 3.7, 3.8, 7.4, 7.7.
 * Correctness properties: 5 (range validation), 6 (next/prev wrap), 20
 * (normalization always yields 960 valid cells and is identity on valid pages).
 */

import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';
import type { PagesData } from '../collab/types';

/** Lowest valid Page_Number (inclusive). Teletext pages run 100..999. */
export const MIN_PAGE = 100;
/** Highest valid Page_Number (inclusive). */
export const MAX_PAGE = 999;
/** Count of distinct Page_Numbers in the range, used for circular wrapping. */
const PAGE_COUNT = MAX_PAGE - MIN_PAGE + 1; // 900

/**
 * The canonical default empty {@link Cell}: space char, white on black, no
 * graphics. Matches the cell produced by `createEmptyPage` in
 * `src/types/teletext.ts`.
 */
function emptyCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

/** Narrow an unknown value to a valid {@link TeletextColor}. */
function isTeletextColor(value: unknown): value is TeletextColor {
  return (
    typeof value === 'string' &&
    (TELETEXT_COLORS as readonly string[]).includes(value)
  );
}

/** Whether a value is a valid `graphics` field (unset, null, or int 0..63). */
function isValidGraphics(value: unknown): value is number | null | undefined {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 63;
}

/**
 * Normalize an unknown value into a single valid {@link Cell}.
 *
 * A cell is considered valid when its `char` is a string and both `fg` and `bg`
 * are valid teletext colors and `graphics` (if present) is null/undefined or an
 * integer in 0..63. Valid cells preserve their present optional fields exactly
 * (so normalization is the identity on already-valid cells); malformed or
 * missing cells collapse to the default empty cell.
 */
function normalizeCell(raw: unknown): Cell {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyCell();
  }
  const source = raw as Partial<Cell> & Record<string, unknown>;
  if (typeof source.char !== 'string') return emptyCell();
  if (!isTeletextColor(source.fg)) return emptyCell();
  if (!isTeletextColor(source.bg)) return emptyCell();
  if ('graphics' in source && !isValidGraphics(source.graphics)) {
    return emptyCell();
  }

  const cell: Cell = { char: source.char, fg: source.fg, bg: source.bg };
  if ('graphics' in source) cell.graphics = source.graphics as number | null;
  if ('graphicsColors' in source) {
    cell.graphicsColors = source.graphicsColors as Cell['graphicsColors'];
  }
  if ('blink' in source) cell.blink = source.blink as boolean;
  if ('doubleHeight' in source) cell.doubleHeight = source.doubleHeight as boolean;
  return cell;
}

/**
 * Normalize arbitrary/unknown input into a valid {@link TeletextPage} of
 * exactly {@link TOTAL_CELLS} (960) cells.
 *
 * Accepts either a positional array of cells or a cell-index map
 * ({@link PageCellMap}, keyed by cell index `0..959`) — both are read by numeric
 * index. Any missing or malformed cell becomes the default empty cell. On an
 * already-valid 960-cell page this returns an equal page.
 *
 * Requirements: 7.4 (empty page when nothing stored), 7.7 (substitute an empty
 * 960-cell page for malformed data). Property 20.
 */
export function normalizePage(raw: unknown): TeletextPage {
  const source =
    raw !== null && typeof raw === 'object'
      ? (raw as Record<PropertyKey, unknown>)
      : undefined;
  const page: TeletextPage = new Array<Cell>(TOTAL_CELLS);
  for (let i = 0; i < TOTAL_CELLS; i++) {
    page[i] = normalizeCell(source ? source[i] : undefined);
  }
  return page;
}

/** Whether a single cell equals the default empty cell (per the glossary). */
function isEmptyCell(cell: Cell): boolean {
  return (
    cell.char === ' ' &&
    cell.fg === 'white' &&
    cell.bg === 'black' &&
    (cell.graphics === null || cell.graphics === undefined) &&
    !cell.blink &&
    !cell.doubleHeight
  );
}

/**
 * Whether a page is a Non_Empty_Page: it contains at least one cell differing
 * from the default empty cell (space char, white on black, no graphics).
 *
 * Requirements: 3.6, 3.7, 3.8 (navigation depends on this).
 */
export function isNonEmptyPage(page: TeletextPage): boolean {
  return page.some((cell) => !isEmptyCell(cell));
}

/**
 * Whether `n` is a valid Page_Number: an integer in the inclusive range
 * 100..999.
 *
 * Requirements: 3.5 (range validation). Property 5.
 */
export function inPageRange(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_PAGE && n <= MAX_PAGE;
}

/** Wrap any integer into the circular Page_Number range 100..999. */
function wrapPage(n: number): number {
  return (((n - MIN_PAGE) % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT + MIN_PAGE;
}

/** Whether the stored page at Page_Number `n` is a Non_Empty_Page. */
function isNonEmptyAt(pages: PagesData, n: number): boolean {
  const raw = pages ? (pages as Record<PropertyKey, unknown>)[n] : undefined;
  if (raw === undefined || raw === null) return false;
  return isNonEmptyPage(normalizePage(raw));
}

/**
 * The nearest higher Non_Empty_Page relative to `cur`, wrapping from 999 to 100.
 *
 * Returns `null` if and only if no Non_Empty_Page other than `cur` exists in the
 * range 100..999.
 *
 * Requirements: 3.6 (advance skipping empty pages, wrap 999->100), 3.8 (null when
 * no other non-empty page). Property 6.
 */
export function nextNonEmptyPage(cur: number, pages: PagesData): number | null {
  for (let step = 1; step <= PAGE_COUNT; step++) {
    const n = wrapPage(cur + step);
    if (n === cur) continue;
    if (isNonEmptyAt(pages, n)) return n;
  }
  return null;
}

/**
 * The nearest lower Non_Empty_Page relative to `cur`, wrapping from 100 to 999.
 *
 * Returns `null` if and only if no Non_Empty_Page other than `cur` exists in the
 * range 100..999.
 *
 * Requirements: 3.7 (return to previous skipping empty pages, wrap 100->999), 3.8
 * (null when no other non-empty page). Property 6.
 */
export function prevNonEmptyPage(cur: number, pages: PagesData): number | null {
  for (let step = 1; step <= PAGE_COUNT; step++) {
    const n = wrapPage(cur - step);
    if (n === cur) continue;
    if (isNonEmptyAt(pages, n)) return n;
  }
  return null;
}
