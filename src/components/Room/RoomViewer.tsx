/**
 * RoomViewer — the in-room, watch-only co-watching screen.
 *
 * A room is purely for watching together: it coordinates which page the group is
 * viewing (synchronized) and the room chat. Page changes go through the vote.
 *
 * The centered teletext screen sits above a bar of realistic objects:
 * - the **remote control** opens a popover with the "request a page" / voting
 *   controls (the {@link VotePanel});
 * - the **yellow pages** opens a directory popup ({@link YellowPages}) to look
 *   up and request a page.
 *
 * When the room's displayed page changes (e.g. an accepted request) the header
 * page number rolls to the target and the content is revealed only once the
 * roll lands.
 *
 * RoomViewer provides {@link RoomContext} around its subtree so the room-scoped
 * hooks resolve the active Room_ID without prop-threading.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router-dom';

import { RoomContext } from '../../collab/RoomContext';
import { useRoomSync } from '../../collab/useRoomSync';
import { useVoting } from '../../collab/useVoting';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import RoomLayout from './RoomLayout';
import ChatSidebar from './ChatSidebar';
import PresenceList from './PresenceList';
import VotePanel from './VotePanel';
import YellowPages from './YellowPages';
import PageSearch from './PageSearch';
import { usePageRoll } from './usePageRoll';
import remoteControlImg from '../../assets/remote_control.png';
import yellowPagesImg from '../../assets/yellow_pages.png';
import magnifyingGlassImg from '../../assets/magnifying_glass.png';

/** Which object popup is currently open. */
type OpenObject = 'remote' | 'guide' | 'search' | null;

export interface RoomViewerProps {
  /**
   * The Room's Room_ID. When omitted it is read from the route params
   * (`/room/:roomId`). Used to scope the room-scoped hooks via {@link RoomContext}.
   */
  roomId?: string;
  /**
   * Optional override for the chat sidebar (used in tests to avoid pulling the
   * live chat hook). Defaults to {@link ChatSidebar}.
   */
  chatSidebar?: ReactNode;
}

/**
 * Inner content: consumes the room-scoped hooks inside {@link RoomContext}.
 */
function RoomViewerContent({
  roomId,
  chatSidebar,
}: Required<Pick<RoomViewerProps, 'roomId'>> &
  Omit<RoomViewerProps, 'roomId'>) {
  const { displayedPageNumber, displayedSubpage, subpageCount, page, stepSubpageBy } =
    useRoomSync();
  const { submit, active } = useVoting();

  // Which object popup is open (remote control popover / yellow pages modal).
  const [openObject, setOpenObject] = useState<OpenObject>(null);
  const remoteSlotRef = useRef<HTMLDivElement>(null);

  // The header rolls to the room's displayed page whenever it changes, and the
  // page content is revealed only once the roll lands.
  const { displayNumber, shownPage } = usePageRoll(displayedPageNumber, page);

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

  // Page selection (yellow pages / index links) routes through the room's vote.
  const handleRequestPage = useCallback(
    (pageNumber: number) => {
      submit(pageNumber);
    },
    [submit],
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
    <RoomLayout
      roomId={roomId}
      sidebar={
        <>
          {/* The room is the one place a member sets their display name. */}
          <PresenceList allowRename />
          {chatSidebar ?? <ChatSidebar />}
        </>
      }
    >
      <div className="room-viewer">
        <div className="room-viewer-screen">
          <div className="tv-bezel">
            <div className="tv-screen">
              <TeletextGrid
                page={shownPage}
                pageNumber={displayNumber}
                subpage={displayedSubpage}
                subpageCount={subpageCount}
                readOnly
                onIndexPageSelect={handleRequestPage}
              />
            </div>
          </div>
          <div className="tv-controls">
            <div className="tv-speaker" aria-hidden="true" />
            <div className="tv-knob-stack">
              {/* Decoration here, unlike the solo set: which page a room watches
                  is the vote's to decide, not a knob's. */}
              <div className="tv-knobs" aria-hidden="true">
                <div className="tv-knob" />
                <div className="tv-knob" />
              </div>
              {/*
                * The subpage pair, which is not a vote. The room agreed on a
                * page; turning to the next screen of it is reading what was
                * agreed, so it applies at once — for everyone, since the
                * subpage is part of the room's synchronized state.
                */}
              <div className="tv-knobs tv-knobs-sub">
                <button
                  type="button"
                  className="tv-knob tv-knob-btn tv-knob-btn-sm"
                  aria-label={`Previous subpage (showing ${displayedSubpage} of ${subpageCount})`}
                  title="Previous subpage"
                  onClick={() => stepSubpageBy(-1)}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="tv-knob tv-knob-btn tv-knob-btn-sm"
                  aria-label={`Next subpage (showing ${displayedSubpage} of ${subpageCount})`}
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
              {active && (
                <span className="object-badge" aria-label="Vote in progress">
                  !
                </span>
              )}
              <span className="object-caption">Remote control</span>
            </button>
            {openObject === 'remote' && (
              <div
                className="remote-popover"
                role="dialog"
                aria-label="Remote control"
              >
                <VotePanel />
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
        <YellowPages onSelect={handleRequestPage} onClose={closeObject} />
      )}

      {openObject === 'search' && (
        <PageSearch onSelect={handleRequestPage} onClose={closeObject} />
      )}
    </RoomLayout>
  );
}

/**
 * Render the synchronized, read-only room viewer, providing {@link RoomContext}
 * around its subtree so the room-scoped hooks resolve the active Room_ID.
 */
export function RoomViewer({ roomId: roomIdProp, ...rest }: RoomViewerProps) {
  const params = useParams<{ roomId: string }>();
  const roomId = roomIdProp ?? params.roomId ?? '';

  return (
    <RoomContext value={roomId}>
      <RoomViewerContent roomId={roomId} {...rest} />
    </RoomContext>
  );
}

export default RoomViewer;
