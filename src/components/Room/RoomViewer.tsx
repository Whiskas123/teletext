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
import { useChat } from '../../collab/useChat';
import { useMediaQuery } from '../../utils/useMediaQuery';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import CrtTelevision from './CrtTelevision';
import RoomLayout from './RoomLayout';
import ChatSidebar from './ChatSidebar';
import VotePanel from './VotePanel';
import YellowPagesDrawer from './YellowPagesDrawer';
import { usePageRoll } from './usePageRoll';
import { useCopy } from './useCopy';

/**
 * Below this the set is drawn as a tube in a thin bezel and its front panel comes
 * out as a handset pinned under the picture, with the consoles below that. The
 * same width `/watch` uses, because it is the same decision about the same
 * cabinet — see `PHONE_QUERY` there.
 */
const PHONE_QUERY = '(max-width: 720px)';

/** Which panel the phone's lower half is showing. */
type PhoneTab = 'remote' | 'vote' | 'chat';

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
  const { submit, active } = useVoting();
  // Only for the count: the log itself is the chat console's business. A room
  // with the conversation behind a tab still has to be able to say that
  // something arrived while you were looking elsewhere.
  const { messages } = useChat();
  const copy = useCopy();

  const phone = useMediaQuery(PHONE_QUERY);

  /*
   * On a phone the rail is not a rail.
   *
   * A room has three things under the picture where watching alone has one, and
   * stacking them put the vote and the conversation below a handset already
   * pinned to the foot of the window — a full screen down, on the screen least
   * willing to scroll. So the lower half holds one at a time behind a strip of
   * tabs, which is the arrangement the editor's own handset uses and the one
   * this app has already taught people.
   */
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('remote');

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

  const chat = chatSidebar ?? <ChatSidebar />;

  /*
   * The lamp on the vote tab: lit for as long as the room is deciding.
   *
   * A status light rather than a notification — so it stays on while you are
   * looking at the vote, the way the lamp on a set stays on while the set is on.
   * It used to go out the moment you opened the tab, which meant the one place
   * the light was worth checking was the one place it was never lit.
   *
   * Only a lamp, though, and never a jump: being moved off the keypad mid-dial
   * because somebody else asked for a page would be the panel taking the screen
   * away from you. This is how a control panel says "over here" without
   * insisting.
   */
  const voteRunning = active !== null;

  /*
   * The chat's lamp is the other kind of light.
   *
   * "New messages" is a fact about what you have not read, so unlike the vote's
   * it goes out when you look and stays out while you are looking. The mark is
   * moved on entering the tab *and* on leaving it: on entering because that is
   * when you read them, and on leaving because anything that arrived while you
   * sat there has been read too. Without the second, stepping away lit the lamp
   * for messages you had just watched arrive.
   *
   * Starting from zero means a room you join with a conversation already in it
   * lights the lamp, which is right: you have not read those either, and on a
   * phone the chat is behind a tab where you would otherwise never learn of it.
   */
  const [seen, setSeen] = useState(0);
  const chatUnread = phoneTab !== 'chat' && messages.length > seen;

  const selectTab = useCallback(
    (tab: PhoneTab) => {
      if (tab === 'chat' || phoneTab === 'chat') setSeen(messages.length);
      setPhoneTab(tab);
    },
    [phoneTab, messages.length],
  );

  const phonePanel =
    phoneTab === 'vote' ? (
      <div className="crt-dock-panel">
        <VotePanel />
      </div>
    ) : phoneTab === 'chat' ? (
      <div className="crt-dock-panel">{chat}</div>
    ) : undefined;

  const phoneTabs = (
    <div className="crt-dock-tabs" role="tablist" aria-label={copy.layout.panels}>
      {(
        [
          ['remote', copy.tv.remote],
          ['vote', copy.vote.name],
          ['chat', copy.chat.name],
        ] as const
      ).map(([tab, label]) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={phoneTab === tab}
          className={`crt-dock-tab${phoneTab === tab ? ' crt-dock-tab-on' : ''}`}
          onClick={() => selectTab(tab)}
        >
          {label}
          {/*
            * Both lamps are decorative, and deliberately so.
            *
            * An `aria-label` on a span *inside* a button joins that button's
            * accessible name, so a lit lamp renamed the tab to "Conversa
            * Mensagens novas" — a control whose name changes as other people
            * type. Neither fact is lost by hiding them: a running vote is
            * announced by the console's own `role="status"` legend, and an
            * arriving message by the log's `aria-live`. The lamp is the sighted
            * shorthand for what is already being said.
            */}
          {tab === 'vote' && voteRunning && (
            <span className="crt-dock-lamp" data-lamp="vote" aria-hidden="true" />
          )}
          {tab === 'chat' && chatUnread && (
            <span className="crt-dock-lamp" data-lamp="chat" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );

  return (
    <RoomLayout
      roomId={roomId}
      sidebar={
        phone ? undefined : (
          <>
            <VotePanel />
            {/* The presence roster folds into the chat's own head; see PresenceList. */}
            {chat}
          </>
        )
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
          handsetHead={phone ? phoneTabs : undefined}
          handsetInstead={phonePanel}
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
