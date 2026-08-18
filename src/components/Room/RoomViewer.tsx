/**
 * RoomViewer — watching teletext together, at `/room/:roomId`.
 *
 * The same television as {@link SoloViewer}, and now the same furniture: the set
 * centred with the directory folded against the left edge as a leaflet, and the
 * consoles that only make sense with other people in the room standing in a rail
 * down the right — the vote on top, the chat under it.
 *
 * ## What replaced the objects
 *
 * There used to be a shelf of photographs under the picture: a remote control, a
 * copy of the yellow pages, a magnifying glass, each opening a popup. It was a
 * nice idea that made the screen a collage — a rendered television standing on a
 * table of cut-out photographs, none of them at the same scale or lit from the
 * same side — and it meant three of the four things you can do in a room were
 * hidden behind pictures of objects rather than being on the set.
 *
 * So the remote's job went back onto the front panel it was always a copy of,
 * the book became the leaflet `/watch` already had, and the magnifier went with
 * it: searching is a field at the top of the directory, because "what is on this
 * service?" and "which page said that?" are the same question asked twice.
 *
 * ## Dialling asks, it does not change
 *
 * The one real difference from watching alone. A room's page is the vote's to
 * decide, so the keypad, the PAGE keys and the fastext colours all *propose*:
 * three digits raise a Change_Request for that page and the room answers it on
 * the {@link VotePanel}. A proposal can come back refused — a vote is already
 * running, or the number is not a page — and the set says so the only way it
 * can, with the `---` it shows any number it cannot go to. See the `refusals`
 * prop on {@link CrtTelevision}.
 *
 * The subpage keys are not proposals. The room agreed on a page; turning to the
 * next screen of it is reading what was agreed, so it applies at once and for
 * everyone, the subpage being part of the room's synchronized state. Power is
 * the opposite again: switching the set off is nobody's business but the person
 * sitting in front of it, and changes nothing anyone else can see.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { RoomContext } from '../../collab/RoomContext';
import { useRoomSync } from '../../collab/useRoomSync';
import { useVoting } from '../../collab/useVoting';
import { useMediaQuery } from '../../utils/useMediaQuery';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import CrtTelevision from './CrtTelevision';
import RoomLayout from './RoomLayout';
import ChatSidebar from './ChatSidebar';
import VotePanel from './VotePanel';
import YellowPagesDrawer from './YellowPagesDrawer';
import { usePageRoll } from './usePageRoll';

/**
 * Below this the set is drawn as a tube in a thin bezel and its front panel comes
 * out as a handset pinned under the picture, with the consoles below that. The
 * same width `/watch` uses, because it is the same decision about the same
 * cabinet — see `PHONE_QUERY` there.
 */
const PHONE_QUERY = '(max-width: 720px)';

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
  const {
    displayedPageNumber,
    displayedSubpage,
    subpageCount,
    page,
    stepSubpageBy,
    peekNextNonEmpty,
    peekPrevNonEmpty,
  } = useRoomSync();
  const { submit } = useVoting();

  const phone = useMediaQuery(PHONE_QUERY);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The header rolls to the room's displayed page whenever it changes, and the
  // page content is revealed only once the roll lands.
  const { displayNumber, shownPage } = usePageRoll(displayedPageNumber, page);

  /*
   * How many times the room has said no to this set.
   *
   * A count rather than a flag: two refusals in a row are two separate noes and
   * both should show in the window, which a boolean somebody has to reset cannot
   * express. {@link CrtTelevision} watches it for changes and never reads it.
   */
  const [refusals, setRefusals] = useState(0);

  /**
   * Ask the room for a page.
   *
   * Every route to a page number ends here — the keypad, the step keys, the
   * fastext strip, a listing in the leaflet — so there is one place where "in a
   * room, choosing is asking" is written down, and one place that notices the
   * answer was no.
   */
  const propose = useCallback(
    (target: number) => {
      const result = submit(target);
      if (!result.ok) setRefusals((count) => count + 1);
    },
    [submit],
  );

  /*
   * The step keys, which have to know where they would land before they ask.
   *
   * `peek` rather than `goto`: the room has not agreed to anything yet, so
   * nothing may move. With no other page to offer — an archive of one page — the
   * press is a refusal, which is the truthful answer and the same one the solo
   * set gives by simply not moving.
   */
  const proposeStep = useCallback(
    (delta: 1 | -1) => {
      const target = delta > 0 ? peekNextNonEmpty() : peekPrevNonEmpty();
      if (target === null) {
        setRefusals((count) => count + 1);
        return;
      }
      propose(target);
    },
    [peekNextNonEmpty, peekPrevNonEmpty, propose],
  );

  /*
   * A listing chosen in the leaflet is a proposal like any other, so the leaflet
   * stays open: the page you asked for has not arrived and may never, and folding
   * the book to reveal an unchanged screen would read as the click having missed.
   * On a phone it folds anyway — there the open leaflet *is* the screen, and the
   * vote console underneath is where the answer will appear.
   */
  const handleSelectPage = useCallback(
    (target: number) => {
      propose(target);
      if (phone) setDrawerOpen(false);
    },
    [propose, phone],
  );

  return (
    <RoomLayout
      roomId={roomId}
      sidebar={
        <>
          <VotePanel />
          {/* The presence roster folds into the chat's own head; see PresenceList. */}
          {chatSidebar ?? <ChatSidebar />}
        </>
      }
    >
      <div
        className={`room-viewer${phone ? ' room-viewer-phone' : ''}${
          drawerOpen ? ' room-viewer-drawer-open' : ''
        }`}
      >
        <CrtTelevision
          pageNumber={displayNumber}
          subpage={displayedSubpage}
          subpageCount={subpageCount}
          onPageEntry={propose}
          onPageStep={proposeStep}
          onSubpageStep={stepSubpageBy}
          onFastext={propose}
          refusals={refusals}
          compact={phone}
        >
          <TeletextGrid
            page={shownPage}
            pageNumber={displayNumber}
            subpage={displayedSubpage}
            subpageCount={subpageCount}
            readOnly
            onIndexPageSelect={propose}
          />
        </CrtTelevision>

        {/*
          * Inside the column rather than beside it, for the reason given in
          * {@link SoloViewer}: on a phone this is where the leaflet lies, in the
          * band of table between the picture and the handset. On anything wider
          * it is `position: fixed` and takes itself back out of this flow.
          */}
        <YellowPagesDrawer
          open={drawerOpen}
          onToggle={toggleDrawer}
          onClose={closeDrawer}
          onSelect={handleSelectPage}
        />
      </div>
    </RoomLayout>
  );
}

/**
 * Render the synchronized room viewer, providing {@link RoomContext} around its
 * subtree so the room-scoped hooks resolve the active Room_ID.
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
