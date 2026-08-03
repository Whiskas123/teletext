/**
 * Changing the publish transforms on several pages at once.
 *
 * The row shift and the menu strip are decisions made at publish time and mostly
 * regretted afterwards, in batches: a whole section published without the shift,
 * or carrying last year's menu bar. Fixing that a page at a time means finding the
 * capture again, remembering which one it was, and re-publishing — twenty times.
 *
 * ## "Leave as it is" is the default for both
 *
 * The two controls are three-way, not on/off. Changing the menu on a run of pages
 * should not also silently turn the shift off on the ones that had it, so each
 * control has to be able to say nothing at all — which is also why Apply stays
 * disabled until at least one of them has something to say.
 *
 * Applying re-publishes each page's own capture with the new transforms. The
 * server re-applies them from the stored capture, so what lands is exactly what a
 * fresh publish would have produced; the page's title and description are read
 * from the live document, so an edited title survives.
 */

import type { CustomMenu } from '../../domain/menu';

/** A transform left alone rather than set. */
export const KEEP = 'keep';

export type ShiftChoice = typeof KEEP | 'on' | 'off';
/** `keep`, `none` (the capture's own strip), or a saved menu's id as a string. */
export type MenuChoice = string;

export interface OnAirBulkBarProps {
  /** Selected page numbers, ascending. */
  selected: readonly number[];
  /** Published pages currently shown, for "select all". */
  selectablePages: readonly number[];
  onSelectAll(): void;
  onClear(): void;
  shift: ShiftChoice;
  onShift(value: ShiftChoice): void;
  menu: MenuChoice;
  onMenu(value: MenuChoice): void;
  menus: readonly CustomMenu[];
  busy: boolean;
  onApply(): void;
}

export function OnAirBulkBar({
  selected,
  selectablePages,
  onSelectAll,
  onClear,
  shift,
  onShift,
  menu,
  onMenu,
  menus,
  busy,
  onApply,
}: OnAirBulkBarProps) {
  if (selectablePages.length === 0) return null;

  const nothingToDo = shift === KEEP && menu === KEEP;

  return (
    <section className="manage-bulk" aria-label="Change transforms on several pages">
      <div className="manage-bulk-head">
        <strong>
          {selected.length === 0
            ? `${selectablePages.length} published pages shown`
            : `${selected.length} selected`}
        </strong>
        <button
          type="button"
          className="manage-mini-btn"
          disabled={busy}
          onClick={onSelectAll}
        >
          Select all shown
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="manage-mini-btn"
            disabled={busy}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="manage-bulk-controls">
          <span className="manage-reorder-field">
            <label className="sidebar-field-label" htmlFor="manage-bulk-shift">
              Shift down one row
            </label>
            <select
              id="manage-bulk-shift"
              value={shift}
              onChange={(event) => onShift(event.target.value as ShiftChoice)}
            >
              <option value={KEEP}>Leave as it is</option>
              <option value="on">Shift down (drops the last row)</option>
              <option value="off">Do not shift</option>
            </select>
          </span>

          <span className="manage-reorder-field">
            <label className="sidebar-field-label" htmlFor="manage-bulk-menu">
              Menu strip
            </label>
            <select
              id="manage-bulk-menu"
              value={menu}
              onChange={(event) => onMenu(event.target.value)}
            >
              <option value={KEEP}>Leave as it is</option>
              <option value="none">The capture's own last row</option>
              {menus.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </select>
          </span>

          <button
            type="button"
            className="sidebar-action-btn"
            disabled={busy || nothingToDo}
            onClick={onApply}
          >
            {busy
              ? 'Republishing…'
              : `Apply to ${selected.length} page${selected.length === 1 ? '' : 's'}`}
          </button>

          <p className="manage-note">
            {nothingToDo
              ? 'Choose a change to apply.'
              : `Re-publishes ${selected.join(', ')} from the archive with the new
                 transforms. Titles and descriptions are kept.`}
          </p>
        </div>
      )}
    </section>
  );
}
