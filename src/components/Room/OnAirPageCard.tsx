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
import { Link } from 'react-router-dom';

import { MAX_PAGE, MIN_PAGE } from '../../domain/pageOps';
import { MAX_SUBPAGE, MIN_SUBPAGE, stepSubpage } from '../../domain/subpages';
import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import type { PageActionName } from '../../domain/inFlight';
import { actionProgress, type Notice } from '../../domain/manageMessages';
import {
  describeMovePreview,
  nudgeRefusal,
  type MovePreview,
} from '../../domain/pageMove';
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
  addSubpage(): void;
  removeLastSubpage(): void;
  remove(): void;
  saveText(): void;
  setRole(kind: PageKind): void;
  openEditor(): void;
  closeEditor(): void;
  editDraft(patch: Partial<OnAirCardDraft>): void;
  discardDraft(): void;
  openMover(): void;
  closeMover(): void;
  setDestination(value: string): void;
  moveTo(destination: number): void;
}

export interface OnAirPageCardProps {
  row: OnAirRow;
  /** The publication record for one screen of this page, or null when it has none. */
  publicationAt(subpage: number): PublishedEntry | null;
  kind: PageKind;
  /** How many screens this page's carousel holds. Always at least 1. */
  subpageCount: number;
  /**
   * Read the live content of one screen, called only when the operator asks to
   * see it. The card passes the screen it is showing, so stepping the carousel
   * changes the preview without re-reading the other screens.
   */
  readContent(subpage: number): TeletextPage | null;
  /** Every page number holding something, for working out what a nudge hits. */
  occupied: ReadonlySet<number>;
  draft: OnAirCardDraft | null;
  editorOpen: boolean;
  /** Whether this page is ticked for a bulk transform change. */
  selected: boolean;
  onToggleSelected(): void;
  /** The destination being typed, or null when this card is not being moved. */
  destination: string | null;
  /** What sending this page to `destination` would do. */
  movePreview: MovePreview | null;
  /** The action running against this page, or null. */
  busy: PageActionName | null;
  /** How this page's last action went. */
  outcome: Notice | null;
  /** Stored values, for spotting an unsaved change. */
  stored: OnAirCardDraft;
  on: OnAirCardCallbacks;
}

export function OnAirPageCard({
  row,
  publicationAt,
  kind,
  subpageCount,
  readContent,
  occupied,
  draft,
  editorOpen,
  selected,
  onToggleSelected,
  destination,
  movePreview,
  busy,
  outcome,
  stored,
  on,
}: OnAirPageCardProps) {
  const [showContent, setShowContent] = useState(false);
  // Which screen of the carousel this card is looking at. Card-local rather
  // than in `useOnAirState`, unlike the editor and the mover: those are
  // one-at-a-time slots the panel arbitrates, while looking at screen 2 of one
  // page says nothing about what you want to see on another.
  const [shownSubpage, setShownSubpage] = useState(MIN_SUBPAGE);
  const { pageNumber } = row;
  const disabled = busy != null;
  // Clamped on read: the count is shared, so another moderator removing a
  // screen must not leave this card pointing at one that is gone.
  const subpage = Math.min(shownSubpage, subpageCount);
  const hasCarousel = subpageCount > MIN_SUBPAGE;
  const entry = publicationAt(subpage);
  const moverOpen = destination != null;
  const canMove = movePreview?.ok === true;

  const unsaved =
    draft != null &&
    (draft.title.trim() !== stored.title.trim() ||
      draft.description.trim() !== stored.description.trim());

  const nudgeButton = (delta: -1 | 1) => {
    const destination = pageNumber + delta;
    // Asked of the page, not of the screen on show: a nudge moves the whole
    // carousel, and whether it may land in the playground is a fact about the
    // page rather than about which of its screens is being looked at.
    const refusal = nudgeRefusal(pageNumber, delta, row.published);
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
        <CaptureImage
          captureId={entry.capture_id}
          label={
            hasCarousel
              ? `Page ${pageNumber}, subpage ${subpage}`
              : `Page ${pageNumber}`
          }
        />
      ) : showContent ? (
        <div className="manage-preview">
          <TeletextGrid page={readContent(subpage) ?? createEmptyPage()} readOnly />
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
        <span className="manage-card-head">
          {/* Only a published page can be re-published, so only a published page
              can join a bulk transform change. Asked of the page rather than of
              the screen on show: a bulk change applies to the whole carousel. */}
          {row.published && (
            <label className="manage-card-pick">
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={onToggleSelected}
              />
              <span className="sr-only">
                Select page {pageNumber} for a bulk change
              </span>
            </label>
          )}
          <strong className="manage-card-number">{pageNumber}</strong>
        </span>
        <span className="manage-card-title">
          {stored.title || <em>untitled</em>}
          {unsaved && (
            <span className="manage-note manage-note-warn"> · unsaved changes</span>
          )}
        </span>

        <span className="manage-card-markers">
          {/* Where the *page* came from, not the screen being looked at — a
              carousel whose second screen was typed by hand is still an archive
              page, and flipping this label as the arrows are pressed would say
              otherwise. */}
          <span className="manage-marker">
            {row.published ? 'Published' : 'Made by hand'}
          </span>
          <span className="manage-marker">
            {row.group === 'curated' ? 'Curated 100–699' : 'Playground 700–999'}
          </span>
        </span>

        {/*
          * The carousel strip: which screen this card is showing, how to reach
          * the others, and how to add or take one away.
          *
          * Always rendered, even on a page with one screen, and for the same
          * reason the TV's header always shows `1/1`: "this page has one
          * screen" is information, and a control that appears only on pages
          * that already have subpages leaves no way to give one to a page that
          * does not.
          *
          * "Remove last" takes the *last* screen rather than the one on show:
          * subpages are numbered by position, so removing from the middle would
          * renumber every screen after it and silently move content the
          * operator never named.
          */}
        <div className="manage-subpages" role="group" aria-label={`Subpages of page ${pageNumber}`}>
          <button
            type="button"
            className="manage-mini-btn"
            aria-label={`Previous subpage of page ${pageNumber}`}
            disabled={disabled || !hasCarousel}
            onClick={() => setShownSubpage(stepSubpage(subpage, subpageCount, -1))}
          >
            ‹
          </button>
          <span className="manage-subpage-count">
            {subpage}/{subpageCount}
          </span>
          <button
            type="button"
            className="manage-mini-btn"
            aria-label={`Next subpage of page ${pageNumber}`}
            disabled={disabled || !hasCarousel}
            onClick={() => setShownSubpage(stepSubpage(subpage, subpageCount, 1))}
          >
            ›
          </button>
          <button
            type="button"
            className="manage-mini-btn"
            disabled={disabled || subpageCount >= MAX_SUBPAGE}
            title={
              subpageCount >= MAX_SUBPAGE
                ? `A page holds at most ${MAX_SUBPAGE} subpages.`
                : `Add an empty subpage to page ${pageNumber}`
            }
            onClick={() => {
              on.addSubpage();
              setShownSubpage(subpageCount + 1);
            }}
          >
            + Subpage
          </button>
          <button
            type="button"
            className="manage-mini-btn manage-mini-btn-danger"
            disabled={disabled || !hasCarousel}
            title={
              hasCarousel
                ? `Delete subpage ${subpageCount} of page ${pageNumber}`
                : 'Subpage 1 is the page itself.'
            }
            onClick={on.removeLastSubpage}
          >
            − Last
          </button>
          {/* Straight into the editor on the screen being looked at, which is
              the point of putting the carousel controls on the card at all. */}
          <Link
            className="manage-mini-btn"
            to={`/edit/${pageNumber}/${subpage}`}
            title={`Open page ${pageNumber} subpage ${subpage} in the editor`}
          >
            Edit content
          </Link>
        </div>

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
        ) : row.published ? (
          // The page came from the archive but this screen of it did not, which
          // is what a subpage added by hand to a published page looks like.
          <span className="manage-note">Subpage {subpage} was not published from the archive.</span>
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
            // The visible text is the same on every card, so the name says which
            // page it belongs to — and changes with the state, or a screen reader
            // would be told "renumber" by the button that cancels it.
            aria-label={
              moverOpen
                ? `Cancel renumbering page ${pageNumber}`
                : `Renumber page ${pageNumber}`
            }
            aria-expanded={moverOpen}
            disabled={disabled}
            onClick={() => (moverOpen ? on.closeMover() : on.openMover())}
          >
            {moverOpen ? 'Cancel move' : 'Move to…'}
          </button>
          <button
            type="button"
            className="manage-mini-btn"
            disabled={disabled}
            onClick={() => (editorOpen ? on.closeEditor() : on.openEditor())}
          >
            {editorOpen ? 'Close' : 'Edit'}
          </button>
          {/* Delete is the one way off air: it empties the page, whether or not
              it had a publication record, so a separate Unpublish would be the
              same action under a second name and a second confirmation. */}
          <button
            type="button"
            className="manage-mini-btn manage-mini-btn-danger"
            disabled={disabled}
            onClick={on.remove}
          >
            Delete
          </button>
        </div>

        {/*
          * Naming a destination, rather than pressing an arrow twelve times.
          *
          * It reports what the move will do before it is made — including how
          * many other pages get renumbered, which is the part that is easy to
          * forget: page numbers are positions, so putting this page at 305 moves
          * whatever is between here and there.
          */}
        {moverOpen && destination != null && (
          <form
            className="manage-move"
            onSubmit={(event) => {
              event.preventDefault();
              if (canMove) on.moveTo(Number(destination));
            }}
          >
            <label className="sidebar-field-label" htmlFor={`m-${pageNumber}`}>
              New number for page {pageNumber}
            </label>
            <div className="manage-move-row">
              <input
                id={`m-${pageNumber}`}
                type="number"
                min={MIN_PAGE}
                max={MAX_PAGE}
                value={destination}
                // The operator opened this to type a number into it.
                autoFocus
                onChange={(event) => on.setDestination(event.target.value)}
              />
              <button
                type="submit"
                className="manage-mini-btn"
                disabled={disabled || !canMove}
              >
                Move
              </button>
            </div>
            {movePreview != null && (
              <p
                className={
                  canMove ? 'manage-note' : 'manage-note manage-note-error'
                }
                role="status"
              >
                {describeMovePreview(movePreview)}
              </p>
            )}
          </form>
        )}

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
