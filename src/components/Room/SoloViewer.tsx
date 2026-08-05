/**
 * SoloViewer — watching teletext on your own, at `/watch`.
 *
 * The same TV as {@link RoomViewer}, minus everything that only makes sense
 * with other people in the room: no chat, no presence list, and no vote. Since
 * there is nobody to agree with, page changes apply immediately — the remote
 * control just changes the page, as a real one would.
 *
 * Page content comes from the same global `pages` channel the rooms and the
 * editor use, so pages edited elsewhere update live while being watched.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useSoloView } from '../../collab/useSoloView';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import RoomLayout from './RoomLayout';
import YellowPages from './YellowPages';
import PageSearch from './PageSearch';
import { usePageRoll } from './usePageRoll';
import remoteControlImg from '../../assets/remote_control.png';
import yellowPagesImg from '../../assets/yellow_pages.png';
import magnifyingGlassImg from '../../assets/magnifying_glass.png';

/** Heading for the solo remote-control popover. */
export const SOLO_REMOTE_HEADING = 'Change page';

/** Which object popup is currently open. */
type OpenObject = 'remote' | 'guide' | 'search' | null;

export interface SoloViewerProps {
  /**
   * Page to open on. When omitted it is read from the route params
   * (`/watch/:pageNumber`), falling back to page 100.
   */
  pageNumber?: number;
}

/**
 * The solo remote control: type a page number and go there. Applies immediately.
 *
 * Stepping lives on the TV's own knobs rather than here — that is where a set
 * puts it, and it kept this panel to the one thing a remote is for.
 */
function SoloRemote({
  onSelect,
}: {
  onSelect: (pageNumber: number) => 'out-of-range' | null;
}) {
  const [draftTarget, setDraftTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const target = parseInt(draftTarget, 10);
    if (onSelect(target) === 'out-of-range') {
      setError('Enter a page number between 100 and 999');
      return;
    }
    setError(null);
    setDraftTarget('');
  };

  

  return (
    <section className="vote-panel" aria-label="Remote control">
      <h2 className="sidebar-heading">{SOLO_REMOTE_HEADING}</h2>

      <form className="vote-remote" onSubmit={handleSubmit} noValidate>
        <div className="vote-remote-row">
          <input
            id="solo-target-input"
            className="vote-target-input"
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={draftTarget}
            placeholder="100"
            aria-label="Page number"
            aria-invalid={error !== null}
            aria-describedby={error ? 'solo-remote-error' : undefined}
            onChange={(event) => {
              // Digits only, up to 3 — matches the room's remote.
              setDraftTarget(event.target.value.replace(/\D/g, '').slice(0, 3));
              if (error) setError(null);
            }}
          />
          <button type="submit" className="sidebar-action-btn vote-submit-btn">
            Go
          </button>
        </div>
        {error && (
          <p id="solo-remote-error" className="vote-error" role="alert">
            {error}
          </p>
        )}
      </form>


    </section>
  );
}

/**
 * Render the solo watching screen: the TV, a remote control, and the yellow
 * pages directory.
 */
export function SoloViewer({ pageNumber: pageNumberProp }: SoloViewerProps) {
  const params = useParams<{ pageNumber: string; subpage: string }>();
  const parsedParam = params.pageNumber
    ? parseInt(params.pageNumber, 10)
    : NaN;
  const initialPageNumber =
    pageNumberProp ?? (Number.isFinite(parsedParam) ? parsedParam : undefined);

  const parsedSubpage = params.subpage ? parseInt(params.subpage, 10) : NaN;

  const {
    displayedPageNumber,
    subpage,
    subpageCount,
    page,
    setDisplayedPage,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
    stepSubpageBy,
  } = useSoloView(
    initialPageNumber,
    Number.isFinite(parsedSubpage) ? parsedSubpage : undefined,
  );

  const { displayNumber, shownPage, skipRoll } = usePageRoll(displayedPageNumber, page);

  // Stepping is not dialling: going back one page should not count up through
  // 998 numbers to get there.
  const stepPrev = useCallback(() => {
    skipRoll();
    return gotoPrevNonEmpty();
  }, [skipRoll, gotoPrevNonEmpty]);

  const stepNext = useCallback(() => {
    skipRoll();
    return gotoNextNonEmpty();
  }, [skipRoll, gotoNextNonEmpty]);

  const [openObject, setOpenObject] = useState<OpenObject>(null);
  const remoteSlotRef = useRef<HTMLDivElement>(null);

  // Close the remote popover on outside click / Escape.
  useEffect(() => {
    if (openObject !== 'remote') return;
    const onDown = (e: MouseEvent) => {
      if (
        remoteSlotRef.current &&
        !remoteSlotRef.current.contains(e.target as Node)
      ) {
        setOpenObject(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenObject(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openObject]);

  // No vote to route through: selections apply straight away. A search result
  // carries the screen it matched on, so choosing it lands on the words that
  // were found rather than on the first screen of the carousel holding them.
  const handleSelectPage = useCallback(
    (target: number, subpage?: number) => {
      setDisplayedPage(target, subpage);
      setOpenObject(null);
    },
    [setDisplayedPage],
  );

  const toggleRemote = useCallback(() => {
    setOpenObject((o) => (o === 'remote' ? null : 'remote'));
  }, []);

  // A toggle, like the remote. It used to only ever open, which meant the
  // icon could not close what it had opened — and because the directory's
  // backdrop covers the whole screen, a second click on the icon landed on
  // the backdrop instead. So a double-click opened and closed it (looking
  // like nothing happened) and two deliberate clicks made it flash.
  const toggleGuide = useCallback(() => {
    setOpenObject((o) => (o === 'guide' ? null : 'guide'));
  }, []);

  // A toggle for the same reason as the directory: its backdrop covers the
  // whole screen, so a second click on the icon would otherwise hit the
  // backdrop and read as nothing happening.
  const toggleSearch = useCallback(() => {
    setOpenObject((o) => (o === 'search' ? null : 'search'));
  }, []);
  const closeObject = useCallback(() => setOpenObject(null), []);

  return (
    <RoomLayout title="Watch solo">
      <div className="room-viewer">
        <div className="room-viewer-screen">
          <div className="tv-bezel">
            <div className="tv-screen">
              <TeletextGrid
                page={shownPage}
                pageNumber={displayNumber}
                subpage={subpage}
                subpageCount={subpageCount}
                readOnly
                onIndexPageSelect={handleSelectPage}
              />
            </div>
          </div>
          <div className="tv-controls">
            <div className="tv-speaker" aria-hidden="true" />
            <div className="tv-knob-stack">
              {/* The chassis knobs, which used to be decoration. A set's tuning
                  knobs stepped through channels, so stepping through pages is
                  what they should have done all along. */}
              <div className="tv-knobs">
                <button
                  type="button"
                  className="tv-knob tv-knob-btn"
                  aria-label="Previous page with content"
                  title="Previous page"
                  onClick={stepPrev}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="tv-knob tv-knob-btn"
                  aria-label="Next page with content"
                  title="Next page"
                  onClick={stepNext}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              {/*
                * The subpage pair: smaller, and tucked under the page knobs
                * rather than beside them, because they are the same gesture at a
                * smaller scale — a carousel is inside a page, not next to it.
                * Left enabled on a page with one screen: the step is a no-op
                * (see `stepSubpage`), and controls that vanish as you change
                * page read as a fault rather than as information. The counter
                * in the header already says whether there is anywhere to go.
                */}
              <div className="tv-knobs tv-knobs-sub">
                <button
                  type="button"
                  className="tv-knob tv-knob-btn tv-knob-btn-sm"
                  aria-label={`Previous subpage (showing ${subpage} of ${subpageCount})`}
                  title="Previous subpage"
                  onClick={() => stepSubpageBy(-1)}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="tv-knob tv-knob-btn tv-knob-btn-sm"
                  aria-label={`Next subpage (showing ${subpage} of ${subpageCount})`}
                  title="Next subpage"
                  onClick={() => stepSubpageBy(1)}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="object-bar" role="toolbar" aria-label="Room objects">
          <div className="object-slot" ref={remoteSlotRef}>
            <button
              type="button"
              className={`object-item${openObject === 'remote' ? ' object-item-active' : ''}`}
              onClick={toggleRemote}
              aria-expanded={openObject === 'remote'}
              aria-label="Remote control"
            >
              <img src={remoteControlImg} alt="" className="object-img" />
              <span className="object-caption">Remote control</span>
            </button>
            {openObject === 'remote' && (
              <div
                className="remote-popover"
                role="dialog"
                aria-label="Remote control"
              >
                <SoloRemote onSelect={setDisplayedPage} />
              </div>
            )}
          </div>

          <div className="object-slot">
            <button
              type="button"
              className={`object-item${openObject === 'guide' ? ' object-item-active' : ''}`}
              onClick={toggleGuide}
              aria-expanded={openObject === 'guide'}
              aria-label="Yellow pages"
            >
              <img src={yellowPagesImg} alt="" className="object-img" />
              <span className="object-caption">Yellow pages</span>
            </button>
          </div>

          <div className="object-slot">
            <button
              type="button"
              className={`object-item${openObject === 'search' ? ' object-item-active' : ''}`}
              onClick={toggleSearch}
              aria-label="Search pages"
            >
              <img src={magnifyingGlassImg} alt="" className="object-img" />
              <span className="object-caption">Search</span>
            </button>
          </div>
        </div>
      </div>

      {openObject === 'guide' && (
        <YellowPages onSelect={handleSelectPage} onClose={closeObject} />
      )}

      {openObject === 'search' && (
        <PageSearch onSelect={handleSelectPage} onClose={closeObject} />
      )}
    </RoomLayout>
  );
}

export default SoloViewer;
