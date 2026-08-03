/**
 * One page on air, and everything that can be done to it.
 *
 * ## The nudge arrows say what they will do
 *
 * Nudging is a block move of one page, and a block move *slides* whatever it
 * passes over — so nudging 204 onto an occupied 205 swaps them. That is the
 * right behaviour for an ordered list, and in a range that fills up it is the
 * only behaviour that keeps working; refusing would make the arrows dead exactly
 * where reordering matters most. What was missing is that the operator could not
 * tell in advance, so the button now says "swap with 205" when that is what it
 * means.
 *
 * ## Content is drawn on request
 *
 * A published page shows its capture, which is one `<img>`. A hand-made page has
 * no capture, so it needs the live grid — and that is 960 elements. With the
 * playground open to every visitor this list can hold hundreds of hand-made
 * pages, which is hundreds of thousands of nodes for previews nobody asked to
 * see. It renders when asked for.
 */

import { useState } from 'react';

import { MAX_PAGE, MIN_PAGE } from '../../domain/pageOps';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';
import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import type { PageActionName } from '../../domain/inFlight';
import { actionProgress, type Notice } from '../../domain/manageMessages';
import type { OnAirRow } from '../../domain/onAirList';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';
import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import { createEmptyPage, type TeletextPage } from '../../types/teletext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import { CaptureImage } from '../TeletextGrid/CaptureImage';

/** Nothing recorded for a field the record was supposed to carry. */
const UNAVAILABLE = 'unavailable';

export interface OnAirCardDraft {
  title: string;
  description: string;
}

export interface OnAirCardCallbacks {
  nudge(delta: -1 | 1): void;
  unpublish(): void;
  remove(): void;
  saveText(): void;
  setRole(kind: PageKind): void;
  openEditor(): void;
  closeEditor(): void;
  editDraft(patch: Partial<OnAirCardDraft>): void;
  discardDraft(): void;
}

export interface OnAirPageCardProps {
  row: OnAirRow;
  entry: PublishedEntry | null;
  kind: PageKind;
  /** Read the live content, called only when the operator asks to see it. */
  readContent(): TeletextPage | null;
  /** Every page number holding something, for working out what a nudge hits. */
  occupied: ReadonlySet<number>;
  draft: OnAirCardDraft | null;
  editorOpen: boolean;
  /** The action running against this page, or null. */
  busy: PageActionName | null;
  /** How this page's last action went. */
  outcome: Notice | null;
  /** Stored values, for spotting an unsaved change. */
  stored: OnAirCardDraft;
  on: OnAirCardCallbacks;
}

/** Why a nudge in this direction is unavailable, or null when it can be made. */
function nudgeRefusal(
  row: OnAirRow,
  delta: -1 | 1,
  published: boolean,
): string | null {
  const destination = row.pageNumber + delta;
  if (destination < MIN_PAGE) return `There is no page below ${MIN_PAGE}.`;
  if (destination > MAX_PAGE) return `There is no page above ${MAX_PAGE}.`;

  // A published page may not cross into the playground — the server refuses it,
  // because 700 and above is editable by any visitor.
  if (published && destination >= PLAYGROUND_MIN_PAGE) {
    return `${PLAYGROUND_MIN_PAGE} and above is the open playground, where any visitor could edit this page.`;
  }
  // And the reverse, which nothing used to stop: nudging 700 down to 699 takes a
  // visitor's own page into the curated range, out of their reach.
  if (!published && row.group === 'playground' && destination < PLAYGROUND_MIN_PAGE) {
    return `Below ${PLAYGROUND_MIN_PAGE} is the curated range, where only a moderator may edit. Use Move block to do this deliberately.`;
  }
  return null;
}

export function OnAirPageCard({
  row,
  entry,
  kind,
  readContent,
  occupied,
  draft,
  editorOpen,
  busy,
  outcome,
  stored,
  on,
}: OnAirPageCardProps) {
  const [showContent, setShowContent] = useState(false);
  const { pageNumber } = row;
  const disabled = busy != null;

  const unsaved =
    draft != null &&
    (draft.title.trim() !== stored.title.trim() ||
      draft.description.trim() !== stored.description.trim());

  const nudgeButton = (delta: -1 | 1) => {
    const destination = pageNumber + delta;
    const refusal = nudgeRefusal(row, delta, entry != null);
    const swaps = refusal == null && occupied.has(destination);
    const label =
      refusal != null
        ? `Cannot move page ${pageNumber} to ${destination}`
        : swaps
          ? `Swap page ${pageNumber} with page ${destination}`
          : `Move page ${pageNumber} to ${destination}`;

    return (
      <button
        type="button"
        className="manage-mini-btn"
        // The glyph alone reads as "left arrow, button", which says nothing
        // about which page moves where.
        aria-label={label}
        title={refusal ?? label}
        disabled={disabled || refusal != null}
        onClick={() => on.nudge(delta)}
      >
        {delta < 0 ? '←' : '→'}
        {swaps && <span className="manage-swap-mark" aria-hidden> ⇄</span>}
      </button>
    );
  };

  return (
    <li className="manage-published-card">
      {entry != null ? (
        <CaptureImage captureId={entry.capture_id} label={`Page ${pageNumber}`} />
      ) : showContent ? (
        <div className="manage-preview">
          <TeletextGrid page={readContent() ?? createEmptyPage()} readOnly />
        </div>
      ) : (
        <button
          type="button"
          className="manage-mini-btn manage-show-content"
          onClick={() => setShowContent(true)}
        >
          Show what page {pageNumber} looks like
        </button>
      )}

      <div className="manage-published-meta">
        <strong className="manage-card-number">{pageNumber}</strong>
        <span className="manage-card-title">
          {stored.title || <em>untitled</em>}
          {unsaved && (
            <span className="manage-note manage-note-warn"> · unsaved changes</span>
          )}
        </span>

        <span className="manage-card-markers">
          <span className="manage-marker">
            {entry != null ? 'Published' : 'Made by hand'}
          </span>
          <span className="manage-marker">
            {row.group === 'curated' ? 'Curated 100–699' : 'Playground 700–999'}
          </span>
        </span>

        {entry != null ? (
          <>
            <span>
              {entry.source?.toUpperCase() ?? UNAVAILABLE}{' '}
              {entry.original_page ?? UNAVAILABLE}
              {entry.topic != null ? ` · ${entry.topic}` : ` · topic ${UNAVAILABLE}`}
            </span>
            <span className="manage-note">
              {entry.shift_down ? 'shifted down one row' : 'not shifted'}
              {entry.menu_name != null ? ` · menu: ${entry.menu_name}` : ' · own menu row'}
            </span>
          </>
        ) : (
          <span className="manage-note">Not from the archive.</span>
        )}

        {!row.hasContent && (
          <span className="manage-note manage-note-warn">
            Holds no content — only a title or a directory role.
          </span>
        )}

        {/* What this page is in the Yellow Pages directory. Stored per page in
            playhtml, so it covers hand-made pages too, and the tree is read off
            page order — see `domain/directory.ts`. */}
        <label className="manage-kind">
          <span className="sr-only">Directory role for page {pageNumber}</span>
          <select
            value={kind}
            disabled={disabled}
            onChange={(e) => on.setRole(e.target.value as PageKind)}
          >
            {PAGE_KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <div className="manage-card-actions">
          {nudgeButton(-1)}
          {nudgeButton(1)}
          <button
            type="button"
            className="manage-mini-btn"
            disabled={disabled}
            onClick={() => (editorOpen ? on.closeEditor() : on.openEditor())}
          >
            {editorOpen ? 'Close' : 'Edit'}
          </button>
          {entry != null && (
            <button
              type="button"
              className="manage-mini-btn"
              disabled={disabled}
              onClick={on.unpublish}
            >
              Unpublish
            </button>
          )}
          <button
            type="button"
            className="manage-mini-btn manage-mini-btn-danger"
            disabled={disabled}
            onClick={on.remove}
          >
            Delete
          </button>
        </div>

        {busy != null && (
          <span className="manage-note manage-card-busy">{actionProgress(busy)}</span>
        )}
        {/*
          * The outcome stays on the card until another action on this page
          * replaces it. The notice line at the top scrolls away; the card is
          * where the operator was looking.
          */}
        {busy == null && outcome != null && (
          <span
            className={
              outcome.tone === 'alert'
                ? 'manage-note manage-note-error'
                : 'manage-note manage-note-done'
            }
          >
            {outcome.text}
          </span>
        )}

        {editorOpen && draft != null && (
          <div className="manage-edit">
            <label className="sidebar-field-label" htmlFor={`t-${pageNumber}`}>
              Title ({draft.title.length}/{MAX_TITLE_LENGTH})
            </label>
            <input
              id={`t-${pageNumber}`}
              className="landing-name-input"
              maxLength={MAX_TITLE_LENGTH}
              value={draft.title}
              onChange={(e) => on.editDraft({ title: e.target.value })}
            />
            <label className="sidebar-field-label" htmlFor={`d-${pageNumber}`}>
              Description ({draft.description.length}/{MAX_DESCRIPTION_LENGTH})
            </label>
            <textarea
              id={`d-${pageNumber}`}
              className="landing-name-input"
              rows={2}
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={draft.description}
              onChange={(e) => on.editDraft({ description: e.target.value })}
            />
            <div className="manage-card-actions">
              <button
                type="button"
                className="sidebar-action-btn"
                disabled={disabled}
                onClick={on.saveText}
              >
                Save
              </button>
              <button
                type="button"
                className="manage-mini-btn"
                disabled={disabled || !unsaved}
                onClick={on.discardDraft}
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
