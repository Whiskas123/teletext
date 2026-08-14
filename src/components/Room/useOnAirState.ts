/**
 * The on-air panel's own working state: the filter, and the open editor.
 *
 * Declared here rather than in the shell so it has one owner, and called *by* the
 * shell so it survives its panel being unmounted while the archive tab is shown.
 * An operator who goes to look at a capture should come back to the filter they
 * typed, not to a cleared list.
 *
 * In its own file rather than beside `OnAirPanel` because a module that exports
 * both a component and a hook cannot be hot-reloaded.
 */

import { useCallback, useState } from 'react';

import {
  EMPTY_ON_AIR_FILTER,
  clampFilterText,
  type OnAirFilter,
  type PublicationRestriction,
  type RangeRestriction,
} from '../../domain/onAirList';
import type { OnAirCardDraft } from './OnAirPageCard';

/** The one inline editor slot, and which page has it. */
export interface EditorState {
  pageNumber: number;
  draft: OnAirCardDraft;
}

/**
 * The one "move to" slot.
 *
 * The destination is held as the string the operator typed, not a number: a
 * half-typed `3` is not page 3, and coercing early makes the field fight back
 * while it is being filled in.
 */
export interface MoverState {
  pageNumber: number;
  destination: string;
}

/**
 * The one open "add a subpage" chooser, and the page number typed into it.
 *
 * Held as the string as typed, like {@link MoverState}: a half-typed `2` is not
 * page 2, and coercing early makes the field fight back while it is being
 * filled in. Empty means "an empty subpage", which is the default the button
 * had before it could also absorb a page.
 */
export interface AdderState {
  pageNumber: number;
  source: string;
}

export interface OnAirState {
  filter: OnAirFilter;
  setFilterText(text: string): void;
  setPublication(value: PublicationRestriction): void;
  setRange(value: RangeRestriction): void;
  clearFilter(): void;
  editor: EditorState | null;
  openEditor(pageNumber: number, stored: OnAirCardDraft): void;
  closeEditor(): void;
  editDraft(patch: Partial<OnAirCardDraft>): void;
  resetDraft(stored: OnAirCardDraft): void;
  /**
   * Published pages ticked for a bulk transform change.
   *
   * Only published pages can be in here: re-applying transforms means publishing
   * the page's capture again, and a hand-made page has no capture.
   */
  selection: ReadonlySet<number>;
  toggleSelected(pageNumber: number): void;
  selectAll(pageNumbers: readonly number[]): void;
  clearSelection(): void;
  /** The one open subpage chooser, and the page it would fold in. */
  adder: AdderState | null;
  openAdder(pageNumber: number): void;
  closeAdder(): void;
  setAdderSource(value: string): void;
  /** The one page being sent to a chosen number, and where to. */
  mover: MoverState | null;
  openMover(pageNumber: number): void;
  closeMover(): void;
  setDestination(value: string): void;
  /**
   * Advanced by `clearFilter` so the panel can put focus back on the input.
   * A counter rather than a boolean: two clears in a row are two requests, and a
   * boolean would have to be reset, which is a second render for nothing.
   */
  focusFilterRequest: number;
}

export function useOnAirState(): OnAirState {
  const [filter, setFilter] = useState<OnAirFilter>(EMPTY_ON_AIR_FILTER);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [mover, setMover] = useState<MoverState | null>(null);
  const [adder, setAdder] = useState<AdderState | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const [focusFilterRequest, setFocusFilterRequest] = useState(0);

  const toggleSelected = useCallback((pageNumber: number) => {
    setSelection((current) => {
      const next = new Set(current);
      if (!next.delete(pageNumber)) next.add(pageNumber);
      return next;
    });
  }, []);

  const selectAll = useCallback((pageNumbers: readonly number[]) => {
    setSelection(new Set(pageNumbers));
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const setFilterText = useCallback((text: string) => {
    setFilter((current) => ({ ...current, text: clampFilterText(text) }));
  }, []);

  const setPublication = useCallback((publication: PublicationRestriction) => {
    setFilter((current) => ({ ...current, publication }));
  }, []);

  const setRange = useCallback((range: RangeRestriction) => {
    setFilter((current) => ({ ...current, range }));
  }, []);

  const clearFilter = useCallback(() => {
    setFilter(EMPTY_ON_AIR_FILTER);
    setFocusFilterRequest((n) => n + 1);
  }, []);

  const openEditor = useCallback((pageNumber: number, stored: OnAirCardDraft) => {
    setEditor({ pageNumber, draft: { ...stored } });
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const editDraft = useCallback((patch: Partial<OnAirCardDraft>) => {
    setEditor((current) =>
      current == null ? current : { ...current, draft: { ...current.draft, ...patch } },
    );
  }, []);

  const resetDraft = useCallback((stored: OnAirCardDraft) => {
    setEditor((current) =>
      current == null ? current : { ...current, draft: { ...stored } },
    );
  }, []);

  const openAdder = useCallback((pageNumber: number) => {
    // Blank, not pre-filled: the common case is still an empty subpage, and a
    // number already in the field would make absorbing a page the default.
    setAdder({ pageNumber, source: '' });
  }, []);

  const closeAdder = useCallback(() => setAdder(null), []);

  const setAdderSource = useCallback((source: string) => {
    setAdder((current) => (current == null ? current : { ...current, source }));
  }, []);

  const openMover = useCallback((pageNumber: number) => {
    // Pre-filled with the page's own number, so the field says what it wants and
    // typing over it is one gesture.
    setMover({ pageNumber, destination: String(pageNumber) });
  }, []);

  const closeMover = useCallback(() => setMover(null), []);

  const setDestination = useCallback((destination: string) => {
    setMover((current) => (current == null ? current : { ...current, destination }));
  }, []);

  return {
    filter,
    setFilterText,
    setPublication,
    setRange,
    clearFilter,
    editor,
    openEditor,
    closeEditor,
    editDraft,
    resetDraft,
    selection,
    toggleSelected,
    selectAll,
    clearSelection,
    adder,
    openAdder,
    closeAdder,
    setAdderSource,
    mover,
    openMover,
    closeMover,
    setDestination,
    focusFilterRequest,
  };
}
