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
import { DEFAULT_PAGE_KIND, type PageKind } from '../../domain/directory';
import { MAX_TITLE_LENGTH } from '../../domain/publication';
import { MAX_SUBPAGE, MIN_SUBPAGE } from '../../domain/subpages';
import type { TeletextPage } from '../../types/teletext';
import type { PublishDraft } from './PublishPanel';

/** How long the free-text term stays quiet before it is queried. */
const TERM_DEBOUNCE_MS = 300;

const EMPTY_DRAFT: PublishDraft = {
  pageNumber: '',
  subpage: '1',
  title: '',
  description: '',
  // On by default: most captures carry a menu strip on their bottom row that the
  // published page replaces anyway, so shifting is the common case and leaving it
  // off meant remembering to tick it every time.
  shiftDown: true,
  menuId: null,
  // Most pages are just pages; a heading is the deliberate choice.
  kind: DEFAULT_PAGE_KIND,
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
  /**
   * Captures queued for publishing in one go, in the order they were ticked.
   * That order is the point: it decides which page number each one lands on.
   */
  batch: CaptureSummary[];
  toggleBatch(capture: CaptureSummary): void;
  clearBatch(): void;
  /** First page number of the run, as typed. */
  batchStart: string;
  setBatchStart(value: string): void;
  /** The directory role every page in the run gets. */
  batchKind: PageKind;
  setBatchKind(kind: PageKind): void;
}

export function useArchiveState(): ArchiveState {
  const [filters, setFilters] = useState<CaptureFilters>({});
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<CaptureSummary | null>(null);
  const [sourcePage, setSourcePage] = useState<TeletextPage | null>(null);
  const [draft, setDraftState] = useState<PublishDraft>(EMPTY_DRAFT);
  const [batch, setBatch] = useState<CaptureSummary[]>([]);
  const [batchStart, setBatchStart] = useState('');
  const [batchKind, setBatchKind] = useState<PageKind>(DEFAULT_PAGE_KIND);

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
      // The capture already knows which screen of its story it was: RTP wrote
      // `01`, SIC wrote `0001`, and `sub_index` is the parsed form. Offering it
      // is what makes publishing a multi-screen story one field per capture
      // instead of a decision to re-derive each time. Out-of-range values fall
      // back to the first screen rather than pre-filling something refusable —
      // a few captures carry sub numbers far past any sane carousel.
      subpage: String(
        capture.sub_index != null &&
          capture.sub_index >= MIN_SUBPAGE &&
          capture.sub_index <= MAX_SUBPAGE
          ? capture.sub_index
          : MIN_SUBPAGE,
      ),
      title: capture.manifest_title?.slice(0, MAX_TITLE_LENGTH) ?? '',
    });
  }, []);

  const setDraft = useCallback((patch: Partial<PublishDraft>) => {
    setDraftState((current) => ({ ...current, ...patch }));
  }, []);

  const toggleBatch = useCallback((capture: CaptureSummary) => {
    setBatch((current) =>
      current.some((item) => item.id === capture.id)
        ? current.filter((item) => item.id !== capture.id)
        : [...current, capture],
    );
  }, []);

  const clearBatch = useCallback(() => setBatch([]), []);

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
    batch,
    toggleBatch,
    clearBatch,
    batchStart,
    setBatchStart,
    batchKind,
    setBatchKind,
  };
}
