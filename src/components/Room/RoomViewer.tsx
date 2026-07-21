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
import VotePanel from './VotePanel';
import YellowPages from './YellowPages';
import remoteControlImg from '../../assets/remote_control.png';
import yellowPagesImg from '../../assets/yellow_pages.png';

/** Delay between each rolling digit step when the displayed page changes. */
const PAGE_ROLL_MS = 22;

/** Which object popup is currently open. */
type OpenObject = 'remote' | 'guide' | null;

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
  const { displayedPageNumber, page } = useRoomSync();
  const { submit, active } = useVoting();

  // Which object popup is open (remote control popover / yellow pages modal).
  const [openObject, setOpenObject] = useState<OpenObject>(null);
  const remoteSlotRef = useRef<HTMLDivElement>(null);

  // --- Page-number roll ---
  // The header rolls to the room's displayed page whenever it changes, and the
  // page CONTENT is revealed only once the roll lands (instead of switching
  // instantly). `page` (the target content) is held in a ref so the roll can
  // reveal it on arrival; `shownPage` is what the grid renders.
  const [displayNumber, setDisplayNumberState] = useState(displayedPageNumber);
  const [shownPage, setShownPage] = useState(page);
  const displayRef = useRef(displayedPageNumber);
  const pageRef = useRef(page);
  pageRef.current = page;
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollingRef = useRef(false);

  const setDisplayNumber = useCallback((n: number) => {
    displayRef.current = n;
    setDisplayNumberState(n);
  }, []);

  const stopRoll = useCallback(() => {
    if (rollTimer.current !== null) {
      clearInterval(rollTimer.current);
      rollTimer.current = null;
    }
  }, []);

  // Roll the header to the displayed page on change; keep content frozen until
  // the roll lands. Declared BEFORE the content-sync effect so it marks the roll
  // in progress first on the render where the displayed page changes.
  useEffect(() => {
    if (displayRef.current === displayedPageNumber) return;
    const target = displayedPageNumber;
    rollingRef.current = true;
    stopRoll();
    rollTimer.current = setInterval(() => {
      const cur = displayRef.current;
      if (cur === target) {
        stopRoll();
        rollingRef.current = false;
        setShownPage(pageRef.current); // reveal the target page content
        return;
      }
      setDisplayNumber(cur < target ? cur + 1 : cur - 1);
    }, PAGE_ROLL_MS);
  }, [displayedPageNumber, stopRoll, setDisplayNumber]);

  // Keep shown content live while idle (so edits to the watched page appear),
  // but never mid-roll (content stays frozen).
  useEffect(() => {
    if (!rollingRef.current) setShownPage(page);
  }, [page]);

  useEffect(() => {
    return () => stopRoll();
  }, [stopRoll]);

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

  const openGuide = useCallback(() => setOpenObject('guide'), []);
  const closeObject = useCallback(() => setOpenObject(null), []);

  return (
    <RoomLayout roomId={roomId} sidebar={chatSidebar ?? <ChatSidebar />}>
      <div className="room-viewer">
        <div className="room-viewer-screen">
          <TeletextGrid
            page={shownPage}
            pageNumber={displayNumber}
            readOnly
            onIndexPageSelect={handleRequestPage}
          />
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
              onClick={openGuide}
              aria-label="Yellow pages"
            >
              <img src={yellowPagesImg} alt="" className="object-img" />
              <span className="object-caption">Yellow pages</span>
            </button>
          </div>
        </div>
      </div>

      {openObject === 'guide' && (
        <YellowPages onSelect={handleRequestPage} onClose={closeObject} />
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
