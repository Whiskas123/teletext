/**
 * Publishing a run of captures in one go.
 *
 * Filling a section a page at a time means picking a capture, typing a number,
 * pressing publish, and repeating — and the numbers are consecutive every time,
 * so the typing is the only part that varies and it is the part most likely to go
 * wrong. Ticking a run and naming where it starts says the same thing once.
 *
 * ## Order is the whole interface
 *
 * Captures land on consecutive page numbers in the order they were ticked, so the
 * bar lists the pairing before anything is written. Nothing else about a publish
 * is configurable here: the transforms are the defaults the single-capture panel
 * uses (shifted down one row, the capture's own menu strip) and the title is the
 * one from the manifest. A page that needs more than that is a page to publish on
 * its own.
 */

import type { CaptureSummary } from '../../collab/useArchiveAdmin';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';
import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import { MIN_PAGE } from '../../domain/pageOps';
import { blockedReason } from './captureMeta';

/** Highest page a run may end on: the curated range stops below the playground. */
const MAX_TARGET = PLAYGROUND_MIN_PAGE - 1;

export interface BatchPublishBarProps {
  batch: readonly CaptureSummary[];
  start: string;
  onStart(value: string): void;
  onClear(): void;
  onRemove(capture: CaptureSummary): void;
  /** Directory role for every page in the run. */
  kind: PageKind;
  onKind(kind: PageKind): void;
  onPublish(startPage: number): void;
  busy: boolean;
  /** Pages that already hold a publication, so the bar can say what it replaces. */
  publishedPages: ReadonlySet<number>;
}

export function BatchPublishBar({
  batch,
  start,
  onStart,
  onClear,
  onRemove,
  kind,
  onKind,
  onPublish,
  busy,
  publishedPages,
}: BatchPublishBarProps) {
  if (batch.length === 0) return null;

  const startPage = Number(start);
  const startValid =
    start !== '' &&
    Number.isInteger(startPage) &&
    startPage >= MIN_PAGE &&
    startPage <= MAX_TARGET;
  const endPage = startPage + batch.length - 1;
  const fits = startValid && endPage <= MAX_TARGET;

  // A capture with no cells would publish a blank page, so the run refuses rather
  // than quietly putting one on air.
  const undecodable = batch.filter((capture) => blockedReason(capture) != null);

  const problem = !startValid
    ? `The first page must be between ${MIN_PAGE} and ${MAX_TARGET}.`
    : !fits
      ? `${batch.length} captures starting at ${startPage} would run past ${MAX_TARGET}.`
      : undecodable.length > 0
        ? `${undecodable.length} of these cannot be decoded, so they would publish blank. Untick them first.`
        : null;

  return (
    <section className="manage-batch" aria-label="Publish several captures">
      <div className="manage-batch-head">
        <strong>{batch.length} selected</strong>
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-batch-start">
            Publish to pages starting at
          </label>
          <input
            id="manage-batch-start"
            type="number"
            min={MIN_PAGE}
            max={MAX_TARGET}
            value={start}
            onChange={(event) => onStart(event.target.value)}
          />
        </span>
        {/* One role for the whole run: a section is a heading and then its pages,
            so the pages get published together and the heading on its own. */}
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-batch-kind">
            Directory role
          </label>
          <select
            id="manage-batch-kind"
            value={kind}
            onChange={(event) => onKind(event.target.value as PageKind)}
          >
            {PAGE_KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </span>
        <button
          type="button"
          className="sidebar-action-btn"
          disabled={busy || problem != null}
          onClick={() => onPublish(startPage)}
        >
          {busy ? 'Publishing…' : `Publish ${batch.length} pages`}
        </button>
        <button
          type="button"
          className="manage-mini-btn"
          disabled={busy}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>

      {problem != null && (
        <p className="manage-note manage-note-error" role="status">
          {problem}
        </p>
      )}

      <ol className="manage-batch-list">
        {batch.map((capture, index) => {
          const target = startValid ? startPage + index : null;
          const replaces = target != null && publishedPages.has(target);
          return (
            <li key={capture.id} className="manage-batch-item">
              <span>
                {capture.source.toUpperCase()} {capture.original_page}
                {capture.sub ? `-${capture.sub}` : ''} →{' '}
                <strong>{target ?? '—'}</strong>
                {replaces && (
                  <span className="manage-note manage-note-warn"> replaces</span>
                )}
                {blockedReason(capture) != null && (
                  <span className="manage-note manage-note-error">
                    {' '}
                    {blockedReason(capture)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="manage-mini-btn"
                aria-label={`Remove ${capture.source.toUpperCase()} ${capture.original_page} from the selection`}
                disabled={busy}
                onClick={() => onRemove(capture)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
