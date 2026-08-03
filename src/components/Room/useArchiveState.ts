/**
 * The archive panel's own working state: filters, place in the results, selection
 * and the publish draft.
 *
 * Declared here so it has one owner, and called by the shell so it survives its
 * panel being unmounted. Losing your place in three thousand captures because you
 * checked what was on page 412 is the thing this prevents.
 *
 * ## The term is held as typed, trimmed on its way to the query
 *
 * `filters.q` is exactly what the operator typed, so the input never fights them
 * over a trailing space. `queryFilters.q` is that value trimmed and debounced —
 * one query per 300 ms of quiet rather than one per keystroke. Every other filter
 * changes once per choice, so it applies at once.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CaptureFilters, CaptureSummary } from '../../collab/useArchiveAdmin';
import { MAX_TITLE_LENGTH } from '../../domain/publication';
import type { TeletextPage } from '../../types/teletext';
import type { PublishDraft } from './PublishPanel';

/** How long the free-text term stays quiet before it is queried. */
const TERM_DEBOUNCE_MS = 300;

const EMPTY_DRAFT: PublishDraft = {
  pageNumber: '',
  title: '',
  description: '',
  // On by default: most captures carry a menu strip on their bottom row that the
  // published page replaces anyway, so shifting is the common case and leaving it
  // off meant remembering to tick it every time.
  shiftDown: true,
  menuId: null,
};

export interface ArchiveState {
  /** The filters as typed. */
  filters: CaptureFilters;
  /** The filters to query with: the same, with the term trimmed and debounced. */
  queryFilters: CaptureFilters;
  offset: number;
  selected: CaptureSummary | null;
  sourcePage: TeletextPage | null;
  setSourcePage(page: TeletextPage | null): void;
  draft: PublishDraft;
  changeFilters(update: (current: CaptureFilters) => CaptureFilters): void;
  clearFilters(): void;
  setOffset(offset: number): void;
  select(capture: CaptureSummary): void;
  setDraft(patch: Partial<PublishDraft>): void;
}

export function useArchiveState(): ArchiveState {
  const [filters, setFilters] = useState<CaptureFilters>({});
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<CaptureSummary | null>(null);
  const [sourcePage, setSourcePage] = useState<TeletextPage | null>(null);
  const [draft, setDraftState] = useState<PublishDraft>(EMPTY_DRAFT);

  useEffect(() => {
    const raw = filters.q ?? '';
    if (raw === debouncedTerm) return;
    const timer = setTimeout(() => setDebouncedTerm(raw), TERM_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.q, debouncedTerm]);

  const queryFilters = useMemo<CaptureFilters>(() => {
    const term = debouncedTerm.trim();
    return { ...filters, q: term === '' ? undefined : term };
  }, [filters, debouncedTerm]);

  const changeFilters = useCallback(
    (update: (current: CaptureFilters) => CaptureFilters) => {
      setFilters(update);
      // The reset belongs here rather than in an effect watching `filters`: doing
      // it as a follow-up would mean a render, and a fetch, against the stale
      // offset first — and page 7 of a result set with three pages shows nothing,
      // which reads as a broken filter.
      setOffset(0);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFilters({});
    setDebouncedTerm('');
    setOffset(0);
  }, []);

  const select = useCallback((capture: CaptureSummary) => {
    setSelected(capture);
    // Cleared, so the previous capture's cells are never shown against this one.
    setSourcePage(null);
    setDraftState({
      ...EMPTY_DRAFT,
      pageNumber: String(capture.original_page),
      title: capture.manifest_title?.slice(0, MAX_TITLE_LENGTH) ?? '',
    });
  }, []);

  const setDraft = useCallback((patch: Partial<PublishDraft>) => {
    setDraftState((current) => ({ ...current, ...patch }));
  }, []);

  return {
    filters,
    queryFilters,
    offset,
    selected,
    sourcePage,
    setSourcePage,
    draft,
    changeFilters,
    clearFilters,
    setOffset,
    select,
    setDraft,
  };
}
