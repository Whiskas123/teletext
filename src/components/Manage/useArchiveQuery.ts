/**
 * The archive pane's query: whether it is open, what it is filtered to, and
 * which page of results it is on.
 *
 * Held above the workspace rather than in the pane, because the data hook
 * needs it — the corpus is only queried once the pane has been opened, and the
 * query is these filters — and so closing the pane to look at a page does not
 * throw away the operator's place in three thousand captures.
 *
 * `filters.q` is exactly what was typed; `queryFilters.q` is that trimmed and
 * debounced, one query per 300 ms of quiet rather than one per keystroke.
 * Every other filter changes once per choice, so it applies at once.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CaptureFilters } from '../../collab/useArchiveAdmin';

const TERM_DEBOUNCE_MS = 300;

export interface ArchiveQuery {
  open: boolean;
  setOpen(open: boolean): void;
  /** Whether the pane has been opened at least once; gates the corpus query. */
  visited: boolean;
  /** The filters as typed. */
  filters: CaptureFilters;
  /** The filters to query with: the same, with the term trimmed and debounced. */
  queryFilters: CaptureFilters;
  changeFilters(update: (current: CaptureFilters) => CaptureFilters): void;
  clearFilters(): void;
  offset: number;
  setOffset(offset: number): void;
}

export function useArchiveQuery(initiallyOpen = false): ArchiveQuery {
  const [open, setOpenState] = useState(initiallyOpen);
  const [visited, setVisited] = useState(initiallyOpen);
  const [filters, setFilters] = useState<CaptureFilters>({});
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [offset, setOffset] = useState(0);

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

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) setVisited(true);
  }, []);

  const changeFilters = useCallback(
    (update: (current: CaptureFilters) => CaptureFilters) => {
      setFilters(update);
      // Reset here rather than in an effect: page 7 of a result set with three
      // pages shows nothing, which reads as a broken filter.
      setOffset(0);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFilters({});
    setDebouncedTerm('');
    setOffset(0);
  }, []);

  return {
    open,
    setOpen,
    visited,
    filters,
    queryFilters,
    changeFilters,
    clearFilters,
    offset,
    setOffset,
  };
}
