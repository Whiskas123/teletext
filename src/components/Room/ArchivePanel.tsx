/**
 * The archive side of `/manage`: find a capture, then put it on a page.
 *
 * Its working state lives in `useArchiveState`, which the shell calls — so an
 * operator who goes to check a page on air comes back to the same filters, the
 * same place in the results and the same selected capture.
 */

import { useEffect, useMemo } from 'react';

import type { CaptureSummary, PublishedEntry } from '../../collab/useArchiveAdmin';
import type { CustomMenu, MenuDraft } from '../../domain/menu';
import type { TeletextPage } from '../../types/teletext';
import { BatchPublishBar } from './BatchPublishBar';
import { CaptureBrowser } from './CaptureBrowser';
import { PublishPanel } from './PublishPanel';
import type { ArchiveState } from './useArchiveState';

export interface ArchivePanelProps {
  state: ArchiveState;
  captures: readonly CaptureSummary[];
  total: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  menus: CustomMenu[];
  onSaveMenu(draft: MenuDraft & { id?: number }): Promise<{ ok: true } | { ok: false; error: string }>;
  onDeleteMenu(id: number): Promise<{ ok: true } | { ok: false; error: string }>;
  loadPage(captureId: number): Promise<TeletextPage | null>;
  livePage(pageNumber: number): TeletextPage | null;
  transform(page: TeletextPage, transforms: { shiftDown: boolean; menuId: number | null }): TeletextPage;
  publicationsByPage: ReadonlyMap<number, PublishedEntry>;
  publishBusy: boolean;
  onPublish(): void;
  onPublishBatch(startPage: number): void;
}

export function ArchivePanel({
  state,
  captures,
  total,
  pageSize,
  loading,
  error,
  onRetry,
  menus,
  onSaveMenu,
  onDeleteMenu,
  loadPage,
  livePage,
  transform,
  publicationsByPage,
  publishBusy,
  onPublish,
  onPublishBatch,
}: ArchivePanelProps) {
  const { selected, setSourcePage } = state;
  const selectedId = selected?.id ?? null;

  /**
   * Fetch the selected capture's cells.
   *
   * As an effect rather than inside the click handler, which is what fixes a
   * real bug: `choose` used to set the selection and then await the fetch with
   * nothing tying the two together, so clicking two captures quickly could leave
   * the second selected with the first's cells in the preview. The operator was
   * approving a render that was not the one going out. Here the cleanup runs
   * before the next load, so a late answer is dropped rather than displayed.
   */
  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;

    void loadPage(selectedId).then((page) => {
      if (!cancelled) setSourcePage(page);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedId, loadPage, setSourcePage]);

  const outgoing = useMemo(
    () =>
      state.sourcePage == null
        ? null
        : transform(state.sourcePage, {
            shiftDown: state.draft.shiftDown,
            menuId: state.draft.menuId,
          }),
    [state.sourcePage, state.draft.shiftDown, state.draft.menuId, transform],
  );

  const target = Number(state.draft.pageNumber);
  const current = Number.isInteger(target) ? livePage(target) : null;

  // A selection made before the filters moved is still perfectly publishable, so
  // it is kept rather than cleared — losing it would throw away the operator's
  // work. Saying it is out of view is enough.
  const selectionOffScreen =
    selected != null && !captures.some((capture) => capture.id === selected.id);

  const publishedPages = useMemo(
    () => new Set(publicationsByPage.keys()),
    [publicationsByPage],
  );

  const batchIds = useMemo(
    () => new Set(state.batch.map((capture) => capture.id)),
    [state.batch],
  );

  return (
    <>
      <BatchPublishBar
        batch={state.batch}
        start={state.batchStart}
        onStart={state.setBatchStart}
        onClear={state.clearBatch}
        onRemove={state.toggleBatch}
        onPublish={onPublishBatch}
        busy={publishBusy}
        publishedPages={publishedPages}
      />

      <div className="manage-body">
      <CaptureBrowser
        filters={state.filters}
        appliedFilters={state.queryFilters}
        onChangeFilters={state.changeFilters}
        onClearFilters={state.clearFilters}
        captures={captures}
        total={total}
        offset={state.offset}
        pageSize={pageSize}
        onOffset={state.setOffset}
        loading={loading}
        error={error}
        onRetry={onRetry}
        selectedId={selectedId}
        onSelect={state.select}
        batchIds={batchIds}
        onToggleBatch={state.toggleBatch}
      />

      <div className="manage-detail-column">
        {selectionOffScreen && (
          <p className="manage-note" role="status">
            The capture below is not in these results, but it is still selected and
            can be published.
          </p>
        )}
        <PublishPanel
          selected={selected}
          sourcePage={state.sourcePage}
          outgoing={outgoing}
          current={current}
          targetEntry={publicationsByPage.get(target) ?? null}
          draft={state.draft}
          onDraft={state.setDraft}
          menus={menus}
          onSaveMenu={onSaveMenu}
          onDeleteMenu={onDeleteMenu}
          publishBusy={publishBusy}
          onPublish={onPublish}
        />
      </div>
      </div>
    </>
  );
}
