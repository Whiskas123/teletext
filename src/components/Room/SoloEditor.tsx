/**
 * SoloEditor — the dedicated, clutter-free editor for the GLOBAL teletext pages
 * and titles (routes `/edit` and `/edit/:pageNumber`).
 *
 * Teletext pages and titles are global shared content: anyone can edit them on
 * their own here, and the edits persist globally so they show up wherever the
 * page is watched. This screen is deliberately standalone — no room chrome, no
 * chat, vote or presence.
 *
 * ## Choosing a page
 *
 * The same way you choose one on the television: an LED window reports it, and
 * digits dial it. On a desk the window is focusable — click it and type three
 * digits, or step with the arrows beside it. On a phone the window opens the
 * page sheet, where the set's own keypad is.
 *
 * Dialling follows the panel's rules exactly (see {@link CrtTelevision}): three
 * digits and it goes, a half-dialled number shows `7--` and is abandoned after
 * {@link DIAL_TIMEOUT_MS}, and a number nobody may edit reads `---`, stays
 * where it was, and says why underneath.
 *
 * Everything else the page needs — its title, its carousel of subpages — is
 * handed to {@link Editor} as slots, and the editor decides where they sit: on
 * the strip across the top of a desk, in the page sheet on a phone.
 *
 * The {@link Editor} itself is driven by {@link useEditPage} (injected `page` +
 * an `onEditCell` cell-level writer). Editing is solo — no cursor / presence.
 *
 * Requirements: 6.1, 6.7, 7.9, 9.3, 9.6.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from './LocalizedLink';

import { useEditPage } from '../../collab/useEditPage';
import { usePageTitles } from '../../collab/useGuide';
import { useIsModerator } from '../../collab/useIsModerator';
import { useSubpages } from '../../collab/useSubpages';
import { canEditPage, PLAYGROUND_MIN_PAGE } from '../../domain/access';
import { MAX_PAGE, MIN_PAGE } from '../../domain/pageOps';
import {
  MAX_SUBPAGE,
  MIN_SUBPAGE,
  clampSubpage,
  normalizeSubpage,
} from '../../domain/subpages';
import { ConfirmKey } from '../Editor/ConfirmKey';
import { EDITOR_NARROW_QUERY, Editor, type EditorPageSheet } from '../Editor/Editor';
import { LedWindow } from '../chrome/LedWindow';
import { useMediaQuery } from '../../utils/useMediaQuery';
import { useCopy } from './useCopy';

/** Default Page_Number for a moderator when none is provided or invalid. */
const DEFAULT_PAGE_NUMBER = 100;

/** Maximum trimmed length of a Page_Title (Req 9.4, 9.6). */
const TITLE_MAX_LENGTH = 60;

/** A half-dialled page number is abandoned after this long, as on the set. */
const DIAL_TIMEOUT_MS = 3000;

/** How long `---` shows after a page number this member cannot edit. */
const DIAL_ERROR_MS = 900;

/** How long the reason a page was refused stays on screen. */
const PAGE_ERROR_MS = 4000;

/** The keypad, 5×2, in the order the television's own is moulded. */
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

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
  const copy = useCopy();
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

  // Local draft for the title so typing is smooth and does not depend on the
  // shared store echoing the value back synchronously. Reseeded when the edited
  // page changes.
  const [titleDraft, setTitleDraft] = useState<string>(() => title(pageNumber));

  // When the edited page changes, resync the title draft to that page.
  useEffect(() => {
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

  /* ── dialling ──────────────────────────────────────────────────────────── */

  /**
   * Digits pressed so far towards a three-digit page number.
   *
   * Held in a ref as well as in state, and read from the ref.
   *
   * A keypad is pressed fast — three digits is one gesture, not three decisions
   * — and three presses that land in one React batch would each read the same
   * pre-batch `dial` from the closure they were rendered with, so `825` dialled
   * quickly arrived as `5`. The ref is what the next press adds to; the state is
   * only what the window is drawn from.
   */
  const dialRef = useRef('');
  const [dial, setDial] = useState('');
  const writeDial = useCallback((next: string) => {
    dialRef.current = next;
    setDial(next);
  }, []);
  /** Set briefly when a completed entry names a page this member may not edit. */
  const [dialError, setDialError] = useState(false);

  // A page half dialled and then abandoned should not sit on the display
  // waiting forever — nor should it still be there to be completed by a digit
  // pressed minutes later, which would open a page nobody asked for.
  useEffect(() => {
    if (dial === '') return;
    const timer = setTimeout(() => writeDial(''), DIAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [dial, writeDial]);

  useEffect(() => {
    if (!dialError) return;
    const timer = setTimeout(() => setDialError(false), DIAL_ERROR_MS);
    return () => clearTimeout(timer);
  }, [dialError]);

  useEffect(() => {
    if (pageError == null) return;
    const timer = setTimeout(() => setPageError(null), PAGE_ERROR_MS);
    return () => clearTimeout(timer);
  }, [pageError]);

  /** Add a digit to the dial; true when that completed a page and opened it. */
  const pressDigit = useCallback(
    (digit: string): boolean => {
      const next = dialRef.current + digit;
      if (next.length < 3) {
        writeDial(next);
        setDialError(false);
        return false;
      }
      writeDial('');
      const target = Number(next);
      if (canEditPage(target, isModerator)) {
        setPageNumber(target);
        setPageError(null);
        return true;
      }
      // Refused, and said so: the window blinks `---` and the reason is spelled
      // out underneath, because "you may not edit the archive" is not something
      // three digits can convey on their own.
      setDialError(true);
      setPageError(
        target >= MIN_PAGE && target <= MAX_PAGE && !isModerator
          ? copy.editor.reservedPages(MIN_PAGE, PLAYGROUND_MIN_PAGE - 1)
          : copy.editor.pagesNumbered(MIN_PAGE, MAX_PAGE),
      );
      return false;
    },
    [isModerator, writeDial, copy],
  );

  // Stepping is not dialling: ▲ goes to the next page this member may edit,
  // which for everyone but the moderator means stopping at the archive rather
  // than counting down into it.
  const lowestEditable = isModerator ? MIN_PAGE : PLAYGROUND_MIN_PAGE;
  const stepPage = useCallback(
    (delta: 1 | -1) => {
      writeDial('');
      setPageError(null);
      setPageNumber((current) => {
        const next = current + delta;
        if (next < lowestEditable || next > MAX_PAGE) return current;
        return next;
      });
    },
    [lowestEditable, writeDial],
  );

  /**
   * The window takes digits from the keyboard too.
   *
   * A keypad is the right control for a thumb and the wrong one for somebody
   * who already has their hands on a keyboard, and the fix costs a handler: the
   * display is focusable, and while it holds focus the number keys dial and the
   * arrows step, exactly as the caps beside it do. Digits typed at the *grid*
   * are page content and never reach here — that input has its own focus.
   */
  const handleDisplayKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        pressDigit(event.key);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        writeDial(dialRef.current.slice(0, -1));
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        stepPage(1);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        stepPage(-1);
      }
    },
    [pressDigit, stepPage, writeDial],
  );

  // What the window reads. A dial in progress shows the digits so far and a dash
  // for each still to come (`7--`), which is what told you the panel had heard
  // the first press and was waiting for the rest.
  const pageDigits = dialError
    ? '---'
    : dial !== ''
      ? dial.padEnd(3, '-')
      : String(pageNumber).padStart(3, '0').slice(-3);
  const subDigits = String(subpage).padStart(2, '0').slice(-2);

  /* ── the rest of the panel ─────────────────────────────────────────────── */

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitleDraft(text);
      const result = setTitle(pageNumber, text);
      // Show a validation message inline when the title is too long; the current
      // title is retained by setTitle (Req 9.6).
      setTitleError(
        result === 'too-long' ? copy.editor.titleTooLong(TITLE_MAX_LENGTH) : null,
      );
    },
    [setTitle, pageNumber, copy],
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

  const isNarrow = useMediaQuery(EDITOR_NARROW_QUERY);

  /* ── the slots handed to the editor ────────────────────────────────────── */

  const led = (
    <LedWindow
      pageDigits={pageDigits}
      subDigits={subDigits}
      label={copy.editor.editingPage(pageNumber, subpage, subpageCount)}
    />
  );

  /*
   * The window and the rockers beside it: what page is open, and the way off
   * it. Always on the strip. On a desk the window takes typed digits; on a
   * phone, which has no keyboard out, it opens the sheet with the keypad in it.
   */
  const pageDisplay = (sheet: EditorPageSheet) => (
    <div className="rc-display-row" onKeyDown={sheet.narrow ? undefined : handleDisplayKeyDown}>
      {sheet.narrow ? (
        <button
          type="button"
          className="rc-display rc-display-button"
          onClick={sheet.open}
          aria-label={`${copy.editor.editingPage(pageNumber, subpage, subpageCount)}. ${copy.editor.pageSetupHint}`}
        >
          {led}
        </button>
      ) : (
        <div
          className="rc-display"
          tabIndex={0}
          role="group"
          title={copy.editor.ledHint}
          aria-label={`${copy.editor.editingPage(pageNumber, subpage, subpageCount)}. ${copy.editor.ledHint}`}
        >
          {led}
        </div>
      )}

      <div className="rc-rocker">
        <div className="rc-rocker-keys">
          <button
            type="button"
            className="rc-key rc-key-rocker"
            aria-label={copy.editor.prevPage}
            title={copy.editor.prevPage}
            onClick={() => stepPage(-1)}
            disabled={pageNumber <= lowestEditable}
          >
            <span className="rc-glyph" aria-hidden>
              ◀
            </span>
          </button>
          <button
            type="button"
            className="rc-key rc-key-rocker"
            aria-label={copy.editor.nextPage}
            title={copy.editor.nextPage}
            onClick={() => stepPage(1)}
            disabled={pageNumber >= MAX_PAGE}
          >
            <span className="rc-glyph" aria-hidden>
              ▶
            </span>
          </button>
        </div>
        <span className="rc-cap">{copy.editor.page}</span>
      </div>

      {/* Why a number was refused: three dashes cannot say it on their own. */}
      {!sheet.narrow && pageError != null && (
        <p className="rc-bubble" role="alert">
          {pageError}
        </p>
      )}
    </div>
  );

  /* The set's own keypad, in the page sheet on a phone. A page dialled closes it. */
  const pageKeypad = (sheet: EditorPageSheet) => (
    <>
      <div className="rc-sheet-dial">
        <div className="rc-display">{led}</div>
        <div className="rc-keypad" role="group" aria-label={copy.editor.dialAPage}>
          {KEYPAD_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              className="rc-key rc-key-digit"
              aria-label={copy.tv.dial(digit)}
              onClick={() => {
                if (pressDigit(digit)) sheet.close();
              }}
            >
              <span className="rc-glyph">{digit}</span>
            </button>
          ))}
        </div>
      </div>
      {pageError != null && (
        <p className="rc-error" role="alert">
          {pageError}
        </p>
      )}
    </>
  );

  /*
   * The carousel, as one key per screen.
   *
   * You can see how many there are and go straight to any of them. `−` takes
   * the *last* screen rather than the one being edited: subpages are numbered
   * by position, so removing from the middle would renumber everything after
   * it under the operator's cursor. It asks first — it takes a screen's
   * drawing with it, and that is not something undo reaches.
   */
  const subpageTabs = (
    <div className="rc-subpages">
      <div className="rc-subpage-row">
        {/* Only the numbers scroll: a drawer hanging off `−` inside a
            scrolling row would be cut off by it. */}
        <div className="rc-subpage-keys" role="tablist" aria-label={copy.editor.subpages}>
          {Array.from({ length: subpageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={n === subpage}
              className={`rc-key rc-key-sub${n === subpage ? ' rc-key-lit' : ''}`}
              onClick={() => setRequestedSubpage(n)}
              aria-label={copy.editor.subpageN(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rc-key rc-key-sub"
          disabled={subpageCount >= MAX_SUBPAGE}
          onClick={handleAddSubpage}
          title={
            subpageCount >= MAX_SUBPAGE
              ? copy.editor.maxSubpages(MAX_SUBPAGE)
              : copy.editor.addSubpageHint
          }
          aria-label={copy.editor.addSubpageHint}
        >
          +
        </button>
        {subpageCount > 1 && (
          <ConfirmKey
            className="rc-key rc-key-sub"
            title={copy.editor.removeSubpageHint(subpageCount)}
            question={copy.editor.removeSubpageConfirm(subpageCount)}
            yes={copy.editor.removeSubpageYes}
            no={copy.editor.clearNo}
            onConfirm={handleRemoveSubpage}
            inline={isNarrow}
            align="end"
          >
            −
          </ConfirmKey>
        )}
      </div>
      <span className="rc-cap">{copy.editor.subpages}</span>
    </div>
  );

  const pageDetails = (
    <>
      <div className="rc-title">
        <input
          id="page-title-input"
          type="text"
          className="rc-field"
          value={titleDraft}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={copy.editor.untitled}
          maxLength={TITLE_MAX_LENGTH * 2}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={titleError != null}
          aria-describedby={titleError != null ? 'page-title-error' : undefined}
        />
        <label className="rc-cap" htmlFor="page-title-input">
          {copy.editor.title}
        </label>
        {titleError != null && (
          <p id="page-title-error" className="rc-bubble" role="alert">
            {titleError}
          </p>
        )}
      </div>
      {subpageTabs}
    </>
  );

  /* The way out, the name on the badge, and the lamp that says it is saving. */
  const nameplate = (
    <div className="rc-brand">
      <Link to="/" className="rc-brand-back" aria-label={copy.layout.backHome} title={copy.layout.backHome}>
        <span aria-hidden>‹</span>
      </Link>
      <span className="rc-brand-name">Teletextron</span>
      <span
        className="rc-status"
        role="status"
        title={saveError != null ? copy.editor.notSaved(saveError) : copy.editor.savedHint}
      >
        <span className={`rc-lamp${saveError != null ? ' rc-lamp-fault' : ''}`} aria-hidden />
        <span className="rc-status-label">
          {saveError != null ? copy.editor.notSaving : copy.editor.saved}
        </span>
      </span>
    </div>
  );

  return (
    <Editor
      pageNumber={pageNumber}
      subpage={subpage}
      subpageCount={subpageCount}
      page={page}
      onEditCell={handleEditCell}
      nameplate={nameplate}
      pageDisplay={pageDisplay}
      pageKeypad={pageKeypad}
      pageDetails={pageDetails}
      alert={
        saveError != null ? (
          <p className="rc-alert" role="alert">
            {copy.editor.notSaved(saveError)}
          </p>
        ) : null
      }
    />
  );
}

export default SoloEditor;
