/**
 * Which pages are selected in the list, and which one has focus.
 *
 * The model every file manager and spreadsheet uses, because it is the one
 * operators already have in their hands:
 *
 * - a plain click selects one row and makes it the anchor;
 * - Cmd/Ctrl-click (or the row's checkbox) adds or removes one row;
 * - Shift-click selects everything between the anchor and the row clicked.
 *
 * Selection is by page number. A renumbering therefore has to carry it along —
 * {@link remap} follows the pages to their new numbers, so a page moved with
 * Alt+↓ stays selected and can be moved again.
 */

import { useCallback, useState } from 'react';

import { remapPages } from '../../domain/lineup';
import type { PageMove } from '../../domain/reorder';

export interface LineupSelection {
  selected: ReadonlySet<number>;
  /** The row with keyboard focus, and the one the inspector shows. */
  active: number | null;
  /** Which screen of the active page the inspector is showing. */
  screen: number;
  setScreen(screen: number): void;
  /** Pages whose screens are expanded under them in the list. */
  expanded: ReadonlySet<number>;
  toggleExpanded(pageNumber: number): void;

  /** Handle a click on a row, by the rules above. `order` is the visible rows. */
  click(
    pageNumber: number,
    modifiers: { shift: boolean; toggle: boolean },
    order: readonly number[],
  ): void;
  /** Move focus to a row; with `extend`, grow the selection to it. */
  focus(pageNumber: number, extend: boolean, order: readonly number[]): void;
  toggle(pageNumber: number): void;
  selectOnly(pageNumber: number): void;
  selectAll(pages: readonly number[]): void;
  clear(): void;
  /** Follow the selection through a renumbering. */
  remap(moves: readonly PageMove[]): void;
}

function range(order: readonly number[], from: number, to: number): number[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

export function useLineupSelection(): LineupSelection {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [screen, setScreen] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const activate = useCallback(
    (pageNumber: number | null) => {
      // A different page opens on its first screen, not on whichever screen
      // the last page happened to be showing.
      if (pageNumber !== active) setScreen(1);
      setActive(pageNumber);
    },
    [active],
  );

  const click = useCallback<LineupSelection['click']>(
    (pageNumber, { shift, toggle }, order) => {
      if (shift && anchor != null) {
        setSelected(new Set(range(order, anchor, pageNumber)));
      } else if (toggle) {
        setSelected((current) => {
          const next = new Set(current);
          if (!next.delete(pageNumber)) next.add(pageNumber);
          return next;
        });
        setAnchor(pageNumber);
      } else {
        setSelected(new Set([pageNumber]));
        setAnchor(pageNumber);
      }
      activate(pageNumber);
    },
    [anchor, activate],
  );

  const focus = useCallback<LineupSelection['focus']>(
    (pageNumber, extend, order) => {
      if (extend) {
        const from = anchor ?? active ?? pageNumber;
        setAnchor(from);
        setSelected(new Set(range(order, from, pageNumber)));
      } else {
        setSelected(new Set([pageNumber]));
        setAnchor(pageNumber);
      }
      activate(pageNumber);
    },
    [anchor, active, activate],
  );

  const toggle = useCallback((pageNumber: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(pageNumber)) next.add(pageNumber);
      return next;
    });
    setAnchor(pageNumber);
  }, []);

  const selectOnly = useCallback(
    (pageNumber: number) => {
      setSelected(new Set([pageNumber]));
      setAnchor(pageNumber);
      activate(pageNumber);
    },
    [activate],
  );

  const selectAll = useCallback((pages: readonly number[]) => {
    setSelected(new Set(pages));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
    setActive(null);
  }, []);

  const toggleExpanded = useCallback((pageNumber: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(pageNumber)) next.add(pageNumber);
      return next;
    });
  }, []);

  const remap = useCallback((moves: readonly PageMove[]) => {
    if (moves.length === 0) return;
    const follow = (page: number | null) =>
      page == null ? null : remapPages([page], moves)[0];
    setSelected((current) => new Set(remapPages(current, moves)));
    setExpanded((current) => new Set(remapPages(current, moves)));
    setActive(follow);
    setAnchor(follow);
  }, []);

  return {
    selected,
    active,
    screen,
    setScreen,
    expanded,
    toggleExpanded,
    click,
    focus,
    toggle,
    selectOnly,
    selectAll,
    clear,
    remap,
  };
}
