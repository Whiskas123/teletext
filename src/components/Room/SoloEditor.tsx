/**
 * SoloEditor — the dedicated, clutter-free editor for the GLOBAL teletext pages
 * and titles (routes `/edit` and `/edit/:pageNumber`).
 *
 * Teletext pages and titles are global shared content: anyone can edit them on
 * their own here, and the edits persist globally so they show up wherever the
 * page is watched. This screen is deliberately standalone — no room chrome, no
 * chat, vote or presence.
 *
 * The editing chrome is integrated INTO the {@link Editor} sidebar (via its
 * `sidebarHeader` slot) so the screen reads as one cohesive editor rather than a
 * separate bar stacked above the tool sidebar. That header provides:
 * - a "Back to home" link;
 * - a page-number chooser (1..999, default 100 or the `:pageNumber` route param)
 *   so the member picks which page to create / edit;
 * - an editable page-title field wired to {@link useGuide} (`title` / `setTitle`),
 *   with an inline "too long" error and a persist-failure indication.
 *
 * The {@link Editor} itself is driven by {@link useEditPage} (injected `page` +
 * an `onEditCell` cell-level writer). Editing is solo — no cursor / presence.
 *
 * Requirements: 6.1, 6.7, 7.9, 9.3, 9.6.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useEditPage } from '../../collab/useEditPage';
import { usePageTitles } from '../../collab/useGuide';
import { useIsModerator } from '../../collab/useIsModerator';
import { useSubpages } from '../../collab/useSubpages';
import { canEditPage, PLAYGROUND_MIN_PAGE } from '../../domain/access';
import { inPageRange } from '../../domain/pageOps';
import {
  MAX_SUBPAGE,
  MIN_SUBPAGE,
  clampSubpage,
  normalizeSubpage,
  stepSubpage,
} from '../../domain/subpages';
import { Editor } from '../Editor/Editor';

/** Default Page_Number for a moderator when none is provided or invalid. */
const DEFAULT_PAGE_NUMBER = 100;

/** Maximum trimmed length of a Page_Title (Req 9.4, 9.6). */
const TITLE_MAX_LENGTH = 60;

/**
 * Resolve the initial Page_Number from the `:pageNumber` route param,
 * defaulting to {@link DEFAULT_PAGE_NUMBER} (moderator) or
 * {@link PLAYGROUND_MIN_PAGE} (everyone else) when absent, out of range, or —
 * for a non-moderator — an archive page.
 */
function resolveInitialPageNumber(
  paramPageNumber: string | undefined,
  isModerator: boolean,
): number {
  const candidate =
    paramPageNumber != null ? parseInt(paramPageNumber, 10) : NaN;
  if (canEditPage(candidate, isModerator)) return candidate;
  return isModerator ? DEFAULT_PAGE_NUMBER : PLAYGROUND_MIN_PAGE;
}

/**
 * Standalone solo editor for a single global Page_Number.
 */
export function SoloEditor() {
  const params = useParams<{ pageNumber: string; subpage: string }>();
  const isModerator = useIsModerator();
  const [pageNumber, setPageNumber] = useState<number>(() =>
    resolveInitialPageNumber(params.pageNumber, isModerator),
  );
  const [pageError, setPageError] = useState<string | null>(null);

  // Which screen of the page's carousel is being edited. Held as a request and
  // clamped on read, so a page losing a subpage under a second editor moves
  // this one to the last real screen instead of onto nothing.
  const { countOf, addSubpage, removeLastSubpage } = useSubpages();
  const [requestedSubpage, setRequestedSubpage] = useState<number>(() =>
    normalizeSubpage(params.subpage),
  );
  const subpageCount = countOf(pageNumber);
  const subpage = clampSubpage(requestedSubpage, subpageCount);

  // Solo editing of the global page: injected page + cell-level writes.
  const { page, editCell, saveError } = useEditPage(pageNumber, subpage);

  // Global TV_Guide title editing for the current page (Req 9.3).
  const { title, setTitle } = usePageTitles();
  const [titleError, setTitleError] = useState<string | null>(null);

  // Free-text draft for the page-number field so it can be typed (cleared and
  // retyped) rather than only stepped with the number spinner. It commits to the
  // edited Page_Number whenever it is a valid 1..999 value.
  const [pageDraft, setPageDraft] = useState<string>(() => String(pageNumber));

  // Local draft for the title so typing is smooth and does not depend on the
  // shared store echoing the value back synchronously. Reseeded when the edited
  // page changes.
  const [titleDraft, setTitleDraft] = useState<string>(() => title(pageNumber));

  // When the edited page changes, resync both drafts to that page.
  useEffect(() => {
    setPageDraft(String(pageNumber));
    setTitleDraft(title(pageNumber));
    setTitleError(null);
    setPageError(null);
    // A new page starts at the top of its carousel: staying on screen 3 because
    // that is where the last page was left would open a screen the operator
    // never asked for, on a page that may not even have one.
    setRequestedSubpage(MIN_SUBPAGE);
    // `title` is intentionally not a dependency: we only reseed on page change,
    // not on every store update, so typing is never clobbered mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  const handlePageDraftChange = useCallback(
    (value: string) => {
      // Allow only digits, up to 3, and permit an empty field while typing.
      const cleaned = value.replace(/\D/g, '').slice(0, 3);
      setPageDraft(cleaned);
      const parsed = parseInt(cleaned, 10);
      if (canEditPage(parsed, isModerator)) {
        setPageNumber(parsed);
        setPageError(null);
        return;
      }
      // Only surface the archive message for an otherwise-valid page number a
      // non-moderator can't edit; stay quiet while a page number is still
      // mid-typed (e.g. "7" on its way to "700").
      setPageError(
        inPageRange(parsed) && !isModerator
          ? `Pages 100–${PLAYGROUND_MIN_PAGE - 1} are the archive — only the moderator can edit them.`
          : null,
      );
    },
    [isModerator],
  );

  const commitPageDraft = useCallback(() => {
    // On blur / Enter, snap the field back to the current valid page if the
    // draft is empty, out of range, or (for a non-moderator) an archive page.
    const parsed = parseInt(pageDraft, 10);
    if (canEditPage(parsed, isModerator)) {
      setPageNumber(parsed);
      setPageDraft(String(parsed));
      setPageError(null);
    } else {
      setPageDraft(String(pageNumber));
      setPageError(null);
    }
  }, [pageDraft, pageNumber, isModerator]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitleDraft(text);
      const result = setTitle(pageNumber, text);
      // Show a validation message inline when the title is too long; the current
      // title is retained by setTitle (Req 9.6).
      setTitleError(
        result === 'too-long'
          ? `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`
          : null,
      );
    },
    [setTitle, pageNumber],
  );

  const handleEditCell = useCallback(
    (index: number, cell: Parameters<typeof editCell>[1]) => {
      editCell(index, cell);
    },
    [editCell],
  );

  const handleAddSubpage = useCallback(() => {
    const added = addSubpage(pageNumber);
    // Straight onto the new screen — adding one and then having to press › to
    // reach it is two gestures for one intention.
    if (added != null) setRequestedSubpage(added);
  }, [addSubpage, pageNumber]);

  const handleRemoveSubpage = useCallback(() => {
    const remaining = removeLastSubpage(pageNumber);
    if (remaining != null) setRequestedSubpage(Math.min(subpage, remaining));
  }, [removeLastSubpage, pageNumber, subpage]);

  // The "Page" section rendered at the top of the editor sidebar so the whole
  // screen is one cohesive editor.
  const sidebarHeader = (
    <>
      <Link to="/" className="sidebar-back-link">
        &lt; Back to home
      </Link>


      <section className="sidebar-section">
        <h2 className="sidebar-heading">Page</h2>

        <div className="sidebar-field">
          <label className="sidebar-field-label" htmlFor="solo-editor-page-input">
            Number (100–999)
          </label>
          <input
            id="solo-editor-page-input"
            type="text"
            inputMode="numeric"
            className="sidebar-input"
            value={pageDraft}
            placeholder="100"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={pageError != null}
            aria-describedby={pageError != null ? 'solo-editor-page-error' : undefined}
            onChange={(e) => handlePageDraftChange(e.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageDraft();
              }
            }}
          />
          {pageError != null && (
            <p id="solo-editor-page-error" className="sidebar-error" role="alert">
              {pageError}
            </p>
          )}
        </div>

        {/*
          * The carousel. A page number can hold several screens (see
          * `domain/subpages.ts`); this is which of them the grid is editing.
          *
          * The arrows wrap and are always live, matching the TV's own subpage
          * knobs — the same control in the same order, so what is learned on
          * one screen works on the other. "Remove last" takes the *last*
          * screen rather than the one being edited: subpages are numbered by
          * position, so removing from the middle would renumber everything
          * after it under the operator's cursor.
          */}
        <div className="sidebar-field">
          <span className="sidebar-field-label" id="solo-editor-subpage-label">
            Subpage
          </span>
          <div className="editor-subpage-row" role="group" aria-labelledby="solo-editor-subpage-label">
            <button
              type="button"
              className="manage-mini-btn"
              aria-label="Previous subpage"
              disabled={subpageCount <= 1}
              onClick={() => setRequestedSubpage(stepSubpage(subpage, subpageCount, -1))}
            >
              ‹
            </button>
            <output className="editor-subpage-count" aria-live="polite">
              {subpage}/{subpageCount}
            </output>
            <button
              type="button"
              className="manage-mini-btn"
              aria-label="Next subpage"
              disabled={subpageCount <= 1}
              onClick={() => setRequestedSubpage(stepSubpage(subpage, subpageCount, 1))}
            >
              ›
            </button>
          </div>
          <div className="editor-subpage-row">
            <button
              type="button"
              className="manage-mini-btn"
              disabled={subpageCount >= MAX_SUBPAGE}
              title={
                subpageCount >= MAX_SUBPAGE
                  ? `A page holds at most ${MAX_SUBPAGE} subpages.`
                  : 'Add an empty subpage at the end and go to it'
              }
              onClick={handleAddSubpage}
            >
              + Add subpage
            </button>
            <button
              type="button"
              className="manage-mini-btn manage-mini-btn-danger"
              disabled={subpageCount <= 1}
              title={
                subpageCount <= 1
                  ? 'Subpage 1 is the page itself.'
                  : `Delete subpage ${subpageCount} and its content`
              }
              onClick={handleRemoveSubpage}
            >
              − Remove last
            </button>
          </div>
        </div>

        <div className="sidebar-field">
          <label className="sidebar-field-label" htmlFor="page-title-input">
            Title
          </label>
          <input
            id="page-title-input"
            type="text"
            className="sidebar-input"
            value={titleDraft}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled page"
            maxLength={TITLE_MAX_LENGTH * 2}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={titleError != null}
            aria-describedby={titleError != null ? 'page-title-error' : undefined}
          />
          {titleError != null && (
            <p id="page-title-error" className="sidebar-error" role="alert">
              {titleError}
            </p>
          )}
        </div>

        {saveError != null && (
          <p className="sidebar-error" role="alert">
            Change not saved: {saveError}
          </p>
        )}
      </section>
    </>
  );

  return (
    <Editor
      pageNumber={pageNumber}
      subpage={subpage}
      subpageCount={subpageCount}
      page={page}
      onEditCell={handleEditCell}
      sidebarHeader={sidebarHeader}
    />
  );
}

export default SoloEditor;
