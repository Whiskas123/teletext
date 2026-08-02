/**
 * Custom navigation menus — the four-colour strip along the bottom of a page.
 *
 * Teletext's fastext row is four coloured labels, each standing for a page you
 * can jump to: red, green, yellow, cyan, left to right. Archive captures come
 * with whatever strip they were broadcast with, pointing at page numbers that
 * mean nothing here, so publishing usually wants to replace it.
 *
 * Menus are named and stored, because the same strip goes on dozens of pages
 * and retyping four labels and four numbers each time is how they end up
 * inconsistent.
 *
 * Everything here is pure: the admin screen renders a live preview from the
 * same function that produces what gets published, so what is shown is what
 * lands.
 */

import {
  COLS,
  ROWS,
  createEmptyPage,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';
import { normalizePage } from './pageOps';
import { inPageRange } from './pageOps';
import { toInteger } from './coerce';

/** The four fastext colours, in the order they appear across the row. */
export const MENU_COLORS: readonly TeletextColor[] = ['red', 'green', 'yellow', 'cyan'];

/** How many links a strip holds. Fixed by the colours, not a preference. */
export const MENU_SLOTS = MENU_COLORS.length;

/** Longest label that fits; see {@link menuLayout} for where this comes from. */
export const MAX_MENU_LABEL = 8;

/** The row a menu is written to: the last row of the page. */
export const MENU_ROW = ROWS - 1;

/** One coloured link. An empty label leaves that quarter of the strip blank. */
export interface MenuItem {
  label: string;
  /** Page this link points at, or `null` for a label with no destination. */
  pageNumber: number | null;
}

/** A named strip, as stored and reused across pages. */
export interface CustomMenu {
  id: number;
  name: string;
  items: MenuItem[];
}

/** A menu being edited, before it has been saved and given an id. */
export type MenuDraft = Omit<CustomMenu, 'id'>;

/**
 * Where each slot starts and how wide it is.
 *
 * The row is 40 cells; four evenly-spaced slots of 10 with a one-cell gutter
 * each side leaves 8 usable characters per label, which is what
 * {@link MAX_MENU_LABEL} is. Computed rather than hard-coded so a different
 * column count would not silently produce a broken strip.
 */
export function menuLayout(): readonly { start: number; width: number }[] {
  const slotWidth = Math.floor(COLS / MENU_SLOTS);
  return MENU_COLORS.map((_, i) => ({
    start: i * slotWidth + 1,
    width: slotWidth - 2,
  }));
}

/** An empty menu draft, for starting a new one. */
export function emptyMenuDraft(): MenuDraft {
  return {
    name: '',
    items: MENU_COLORS.map(() => ({ label: '', pageNumber: null })),
  };
}

/** Why a menu could not be saved. */
export type MenuRejection = 'name-empty' | 'name-too-long' | 'label-too-long' | 'page-out-of-range';

export const MAX_MENU_NAME = 40;

export type ValidateMenuResult =
  | { ok: true; value: MenuDraft }
  | { ok: false; reason: MenuRejection };

/** Human-readable explanation of a rejection, for the admin screen. */
export function describeMenuRejection(reason: MenuRejection): string {
  switch (reason) {
    case 'name-empty':
      return 'Give the menu a name so you can find it again.';
    case 'name-too-long':
      return `Name must be ${MAX_MENU_NAME} characters or fewer.`;
    case 'label-too-long':
      return `Each label must be ${MAX_MENU_LABEL} characters or fewer — that is all that fits.`;
    case 'page-out-of-range':
      return 'Linked pages must be between 100 and 999.';
  }
}

/**
 * Validate and normalise a draft.
 *
 * Labels are trimmed and upper-cased: the strip is rendered in the teletext
 * font at a fixed width, and mixed case there reads badly and eats the little
 * room there is. Slots are padded out to {@link MENU_SLOTS} so a short list is
 * still a well-formed strip.
 */
export function validateMenu(draft: {
  name?: unknown;
  items?: unknown;
}): ValidateMenuResult {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (name.length === 0) return { ok: false, reason: 'name-empty' };
  if (name.length > MAX_MENU_NAME) return { ok: false, reason: 'name-too-long' };

  const rawItems = Array.isArray(draft.items) ? draft.items : [];
  const items: MenuItem[] = [];

  for (let i = 0; i < MENU_SLOTS; i += 1) {
    const raw = (rawItems[i] ?? {}) as { label?: unknown; pageNumber?: unknown };
    const label = (typeof raw.label === 'string' ? raw.label : '').trim().toUpperCase();
    if (label.length > MAX_MENU_LABEL) return { ok: false, reason: 'label-too-long' };

    let pageNumber: number | null = null;
    if (raw.pageNumber != null && raw.pageNumber !== '') {
      const parsed = toInteger(raw.pageNumber);
      if (parsed == null || !inPageRange(parsed)) {
        return { ok: false, reason: 'page-out-of-range' };
      }
      pageNumber = parsed;
    }

    items.push({ label, pageNumber });
  }

  return { ok: true, value: { name, items } };
}

/**
 * The strip as a row of {@link COLS} cells.
 *
 * Each label is drawn in its slot's colour on black. A slot with an empty label
 * is left blank rather than filled with its colour, so a two-link menu looks
 * deliberate instead of broken.
 */
export function renderMenuRow(menu: Pick<CustomMenu, 'items'>): Cell[] {
  const row: Cell[] = Array.from({ length: COLS }, () => ({
    char: ' ',
    fg: 'white' as TeletextColor,
    bg: 'black' as TeletextColor,
    graphics: null,
  }));

  const layout = menuLayout();
  for (const [slot, item] of menu.items.slice(0, MENU_SLOTS).entries()) {
    const label = item.label.slice(0, layout[slot].width);
    if (label.length === 0) continue;

    for (let i = 0; i < label.length; i += 1) {
      const col = layout[slot].start + i;
      if (col >= COLS) break;
      row[col] = {
        char: label[i],
        fg: MENU_COLORS[slot],
        bg: 'black',
        graphics: null,
      };
    }
  }

  return row;
}

/**
 * A copy of `page` with the menu written over its last row.
 *
 * Replaces the row outright rather than merging: whatever the capture was
 * broadcast with is exactly what this is meant to get rid of.
 */
export function applyMenu(page: TeletextPage, menu: Pick<CustomMenu, 'items'>): TeletextPage {
  const result = normalizePage(page).map((cell) => ({ ...cell }));
  const row = renderMenuRow(menu);
  for (let col = 0; col < COLS; col += 1) {
    result[MENU_ROW * COLS + col] = row[col];
  }
  return result;
}

/** A page showing only the menu, for previewing a strip on its own. */
export function menuPreviewPage(menu: Pick<CustomMenu, 'items'>): TeletextPage {
  return applyMenu(createEmptyPage(), menu);
}

/**
 * The page numbers a menu links to, in slot order, skipping empty slots.
 * Used to warn when a menu points at a page that is not published.
 */
export function menuTargets(menu: Pick<CustomMenu, 'items'>): number[] {
  return menu.items
    .map((item) => item.pageNumber)
    .filter((page): page is number => page != null);
}
