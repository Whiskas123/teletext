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
import { useGuide } from '../../collab/useGuide';
import { inPageRange } from '../../domain/pageOps';
import { Editor } from '../Editor/Editor';

/** Default Page_Number when none is provided or the provided value is invalid. */
const DEFAULT_PAGE_NUMBER = 100;

/** Maximum trimmed length of a Page_Title (Req 9.4, 9.6). */
const TITLE_MAX_LENGTH = 60;

/**
 * Resolve the initial Page_Number from the `:pageNumber` route param, defaulting
 * to {@link DEFAULT_PAGE_NUMBER} when absent or out of the valid 1..999 range.
 */
function resolveInitialPageNumber(paramPageNumber: string | undefined): number {
  const candidate =
    paramPageNumber != null ? parseInt(paramPageNumber, 10) : NaN;
  return inPageRange(candidate) ? candidate : DEFAULT_PAGE_NUMBER;
}

/**
 * Standalone solo editor for a single global Page_Number.
 */
export function SoloEditor() {
  const params = useParams<{ pageNumber: string }>();
  const [pageNumber, setPageNumber] = useState<number>(() =>
    resolveInitialPageNumber(params.pageNumber),
  );

  // Solo editing of the global page: injected page + cell-level writes.
  const { page, editCell, saveError } = useEditPage(pageNumber);

  // Global TV_Guide title editing for the current page (Req 9.3).
  const { title, setTitle } = useGuide();
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
    // `title` is intentionally not a dependency: we only reseed on page change,
    // not on every store update, so typing is never clobbered mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  const handlePageDraftChange = useCallback((value: string) => {
    // Allow only digits, up to 3, and permit an empty field while typing.
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setPageDraft(cleaned);
    const parsed = parseInt(cleaned, 10);
    if (inPageRange(parsed)) {
      setPageNumber(parsed);
    }
  }, []);

  const commitPageDraft = useCallback(() => {
    // On blur / Enter, snap the field back to the current valid page if the
    // draft is empty or out of range.
    const parsed = parseInt(pageDraft, 10);
    if (inPageRange(parsed)) {
      setPageNumber(parsed);
      setPageDraft(String(parsed));
    } else {
      setPageDraft(String(pageNumber));
    }
  }, [pageDraft, pageNumber]);

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
            onChange={(e) => handlePageDraftChange(e.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageDraft();
              }
            }}
          />
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
      page={page}
      onEditCell={handleEditCell}
      sidebarHeader={sidebarHeader}
    />
  );
}

export default SoloEditor;
