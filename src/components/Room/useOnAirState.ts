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
   * Advanced by `clearFilter` so the panel can put focus back on the input.
   * A counter rather than a boolean: two clears in a row are two requests, and a
   * boolean would have to be reset, which is a second render for nothing.
   */
  focusFilterRequest: number;
}

export function useOnAirState(): OnAirState {
  const [filter, setFilter] = useState<OnAirFilter>(EMPTY_ON_AIR_FILTER);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [focusFilterRequest, setFocusFilterRequest] = useState(0);

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
    focusFilterRequest,
  };
}
