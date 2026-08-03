/**
 * The pages the service is showing, and the tools that rearrange them.
 *
 * This used to be the bottom half of one long screen: every occupied page number
 * in a single unbroken grid, up to 900 cards, with no way to reach page 412
 * except scrolling past 300 others. Two things changed. The list is filtered, and
 * it is split into the two groups the service already has — 100–699 curated,
 * where only a moderator writes, and 700–999 the open playground.
 *
 * Its working state lives in `useOnAirState`, which the shell calls — so the
 * filter an operator typed survives a look at the archive tab.
 */

import { useEffect, useMemo, useRef } from 'react';

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import type { PageKind } from '../../domain/directory';
import type { Notice } from '../../domain/manageMessages';
import { describeOnAirFilter, noOnAirMatch } from '../../domain/manageMessages';
import {
  groupOf,
  groupOnAirPages,
  isFiltering,
  type OnAirRow,
  type PublicationRestriction,
  type RangeRestriction,
} from '../../domain/onAirList';
import type { InFlightView } from '../../domain/inFlight';
import { previewMove } from '../../domain/pageMove';
import type { TeletextPage } from '../../types/teletext';
import { OnAirPageCard, type OnAirCardDraft } from './OnAirPageCard';
import { ReorderTools, type ReorderToolsProps } from './ReorderTools';
import type { OnAirState } from './useOnAirState';

export interface OnAirPanelProps {
  state: OnAirState;
  /** Every page holding something, ascending. */
  occupiedPages: readonly number[];
  publicationsByPage: ReadonlyMap<number, PublishedEntry>;
  publicationsError: string | null;
  onRetryPublications(): void;
  inFlight: InFlightView;
  outcomes: ReadonlyMap<number, Notice>;
  titleOf(pageNumber: number): string;
  descriptionOf(pageNumber: number): string;
  kindOf(pageNumber: number): PageKind;
  livePage(pageNumber: number): TeletextPage | null;
  onNudge(pageNumber: number, delta: -1 | 1): void;
  onMoveTo(pageNumber: number, destination: number): void;
  onUnpublish(pageNumber: number): void;
  onDelete(pageNumber: number, title: string): void;
  onSaveText(pageNumber: number, draft: OnAirCardDraft): void;
  onSetRole(pageNumber: number, kind: PageKind): void;
  onShift: ReorderToolsProps['onShift'];
  onMove: ReorderToolsProps['onMove'];
  onNotice(notice: Notice): void;
}

export function OnAirPanel({
  state,
  occupiedPages,
  publicationsByPage,
  publicationsError,
  onRetryPublications,
  inFlight,
  outcomes,
  titleOf,
  descriptionOf,
  kindOf,
  livePage,
  onNudge,
  onMoveTo,
  onUnpublish,
  onDelete,
  onSaveText,
  onSetRole,
  onShift,
  onMove,
  onNotice,
}: OnAirPanelProps) {
  const filterRef = useRef<HTMLInputElement>(null);

  // Focus goes back to the input when the clear control was used, and only then:
  // the counter starts at zero and only that control advances it, so no other
  // render can pull focus off whatever the operator was typing in.
  useEffect(() => {
    if (state.focusFilterRequest === 0) return;
    filterRef.current?.focus();
  }, [state.focusFilterRequest]);

  const occupied = useMemo(() => new Set(occupiedPages), [occupiedPages]);
  const publishedNumbers = useMemo(
    () => new Set(publicationsByPage.keys()),
    [publicationsByPage],
  );

  const rows = useMemo<OnAirRow[]>(
    () =>
      occupiedPages.map((pageNumber) => ({
        pageNumber,
        group: groupOf(pageNumber),
        title: titleOf(pageNumber),
        published: publicationsByPage.has(pageNumber),
        hasContent: livePage(pageNumber) != null,
      })),
    [occupiedPages, titleOf, publicationsByPage, livePage],
  );

  const groups = useMemo(
    () => groupOnAirPages(rows, state.filter),
    [rows, state.filter],
  );

  const filtering = isFiltering(state.filter);

  const renderCard = (row: OnAirRow) => {
    const stored: OnAirCardDraft = {
      title: row.title,
      description: descriptionOf(row.pageNumber),
    };
    const editorOpen = state.editor?.pageNumber === row.pageNumber;
    const destination =
      state.mover?.pageNumber === row.pageNumber ? state.mover.destination : null;

    return (
      <OnAirPageCard
        key={row.pageNumber}
        row={row}
        entry={publicationsByPage.get(row.pageNumber) ?? null}
        kind={kindOf(row.pageNumber)}
        readContent={() => livePage(row.pageNumber)}
        occupied={occupied}
        stored={stored}
        draft={editorOpen ? (state.editor?.draft ?? null) : null}
        editorOpen={editorOpen}
        destination={destination}
        movePreview={
          destination == null
            ? null
            : previewMove({
                occupied: occupiedPages,
                published: publishedNumbers,
                fromPage: row.pageNumber,
                // An empty or half-typed field is not a page number, and
                // `previewMove` says so rather than being asked to guess.
                destination: destination === '' ? Number.NaN : Number(destination),
              })
        }
        busy={inFlight.pageBusy(row.pageNumber)}
        outcome={outcomes.get(row.pageNumber) ?? null}
        on={{
          nudge: (delta) => onNudge(row.pageNumber, delta),
          openMover: () => state.openMover(row.pageNumber),
          closeMover: state.closeMover,
          setDestination: state.setDestination,
          moveTo: (target) => onMoveTo(row.pageNumber, target),
          unpublish: () => onUnpublish(row.pageNumber),
          remove: () => onDelete(row.pageNumber, row.title),
          saveText: () => {
            if (state.editor != null) onSaveText(row.pageNumber, state.editor.draft);
          },
          setRole: (kind) => onSetRole(row.pageNumber, kind),
          openEditor: () => state.openEditor(row.pageNumber, stored),
          closeEditor: state.closeEditor,
          editDraft: state.editDraft,
          discardDraft: () => state.resetDraft(stored),
        }}
      />
    );
  };

  const group = (
    label: string,
    empty: string,
    listed: readonly OnAirRow[],
  ) => (
    <section className="manage-group" aria-label={label}>
      <h3 className="manage-group-title">{label}</h3>
      {listed.length === 0 ? (
        <p className="landing-section-description">{empty}</p>
      ) : (
        <ul className="manage-published-grid">{listed.map(renderCard)}</ul>
      )}
    </section>
  );

  return (
    <div className="manage-on-air">
      <div className="manage-filters" role="search">
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-on-air-filter">
            Find a page
          </label>
          <input
            id="manage-on-air-filter"
            ref={filterRef}
            type="search"
            className="landing-name-input"
            placeholder="number or title"
            value={state.filter.text}
            onChange={(e) => state.setFilterText(e.target.value)}
          />
        </span>

        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-on-air-publication">
            Source
          </label>
          <select
            id="manage-on-air-publication"
            value={state.filter.publication}
            onChange={(e) =>
              state.setPublication(e.target.value as PublicationRestriction)
            }
          >
            <option value="both">Archive and hand-made</option>
            <option value="published">From the archive</option>
            <option value="hand-made">Made by hand</option>
          </select>
        </span>

        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-on-air-range">
            Range
          </label>
          <select
            id="manage-on-air-range"
            value={state.filter.range}
            onChange={(e) => state.setRange(e.target.value as RangeRestriction)}
          >
            <option value="both">100–999</option>
            <option value="curated">Curated 100–699</option>
            <option value="playground">Playground 700–999</option>
          </select>
        </span>

        {filtering && (
          <>
            <span className="manage-note">
              {groups.shown} of {groups.total} shown, {describeOnAirFilter(state.filter)}
            </span>
            <button type="button" className="manage-mini-btn" onClick={state.clearFilter}>
              Clear filter
            </button>
          </>
        )}
      </div>

      {publicationsError != null ? (
        /*
          * In place of the list, not beside it. An empty grid would read as
          * "nothing is on air", which is a lie that invites deleting pages that
          * are perfectly fine.
          */
        <div className="manage-load-error" role="alert">
          <p className="manage-note manage-note-error">{publicationsError}</p>
          <button type="button" className="manage-mini-btn" onClick={onRetryPublications}>
            Try loading the published pages again
          </button>
        </div>
      ) : groups.total === 0 ? (
        // No Reorder_Tools at all: there is nothing to renumber, and rendering
        // them disabled would put three dead controls in the way.
        <p className="landing-section-description">No page holds any content yet.</p>
      ) : (
        <>
          <ReorderTools onShift={onShift} onMove={onMove} onNotice={onNotice} />

          {groups.shown === 0 ? (
            <div className="manage-no-match">
              <p className="landing-section-description">{noOnAirMatch(state.filter)}</p>
              <button
                type="button"
                className="manage-mini-btn"
                onClick={state.clearFilter}
              >
                Clear filter
              </button>
            </div>
          ) : (
            <>
              {group(
                'Curated 100–699',
                'No page in 100–699 matches.',
                groups.curated,
              )}
              {group(
                'Playground 700–999',
                'No page in 700–999 matches.',
                groups.playground,
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
