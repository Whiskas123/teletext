/**
 * SoloViewer — watching teletext on your own, at `/watch`.
 *
 * The same TV as {@link RoomViewer}, minus everything that only makes sense
 * with other people in the room: no chat, no presence list, and no vote. Since
 * there is nobody to agree with, page changes apply immediately — the remote
 * control just changes the page, as a real one would.
 *
 * Nothing stands under the set here either. A room needs its props on the table
 * — the remote to ask for a page, the book, the magnifier — but alone the
 * television's own front panel is the remote, so the picture is the whole
 * screen and the directory folds away against the left edge as a leaflet you
 * pull open. See {@link YellowPagesDrawer}.
 *
 * Page content comes from the same global `pages` channel the rooms and the
 * editor use, so pages edited elsewhere update live while being watched.
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useSoloView } from '../../collab/useSoloView';
import { useMediaQuery } from '../../utils/useMediaQuery';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import CrtTelevision from './CrtTelevision';
import RoomLayout from './RoomLayout';
import YellowPagesDrawer from './YellowPagesDrawer';
import { usePageRoll } from './usePageRoll';

/**
 * Below this the set is drawn as a tube in a thin bezel and its front panel
 * comes out as a handset pinned to the bottom of the screen.
 *
 * The same width the phone rules in `App.css` are written at, because it is the
 * same decision: at this size the props stop standing beside the television and
 * go under it, and there is no longer room for a cabinet as well as a picture.
 */
const PHONE_QUERY = '(max-width: 720px)';

export interface SoloViewerProps {
  /**
   * Page to open on. When omitted it is read from the route params
   * (`/watch/:pageNumber`), falling back to page 100.
   */
  pageNumber?: number;
}

/**
 * Render the solo watching screen: the television, centred, and the directory
 * folded against the left edge beside it.
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
  const stepPage = useCallback(
    (delta: 1 | -1) => {
      skipRoll();
      return delta > 0 ? gotoNextNonEmpty() : gotoPrevNonEmpty();
    },
    [skipRoll, gotoNextNonEmpty, gotoPrevNonEmpty],
  );

  // Dialling, on the other hand, keeps the roll: counting up to the number you
  // typed is what a set did while it waited for that page to come round again,
  // and it is the one piece of teletext that was never instant.
  const handleDialPage = useCallback(
    (target: number) => {
      setDisplayedPage(target);
    },
    [setDisplayedPage],
  );

  const phone = useMediaQuery(PHONE_QUERY);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // No vote to route through: selections apply straight away. A search result
  // carries the screen it matched on, so choosing it lands on the words that
  // were found rather than on the first screen of the carousel holding them.
  //
  // The leaflet is left open on a wide screen — the set has already moved over
  // to make room for it, so the page you chose is in plain sight and the next
  // one is a click away. On a phone the open leaflet *is* the screen, so it
  // folds itself back to show you what you asked for.
  const handleSelectPage = useCallback(
    (target: number, subpage?: number) => {
      setDisplayedPage(target, subpage);
      if (phone) setDrawerOpen(false);
    },
    [setDisplayedPage, phone],
  );

  return (
    <RoomLayout title="">
      <div
        className={`room-viewer room-viewer-solo${phone ? ' room-viewer-phone' : ''}${
          drawerOpen ? ' room-viewer-drawer-open' : ''
        }`}
      >
        {/*
          * The whole front panel is live here. There is nobody to agree with, so
          * every key does what the label says it does: the keypad dials a page
          * the way you always dialled one, the PAGE pair steps, the SUBPAGE pair
          * turns the carousel, and the fastext colours jump to the four
          * destinations along the bottom of the picture.
          *
          * The subpage keys stay live on a page with one screen: the step is a
          * no-op (see `stepSubpage`), and a control that vanishes as you change
          * page reads as a fault rather than as information. The counter in the
          * header already says whether there is anywhere to go.
          *
          * On a phone the same panel arrives as a handset under the picture
          * instead of moulded into the cabinet — same keys, same wiring, twice
          * the size. See `compact` in {@link CrtTelevision}.
          */}
        <CrtTelevision
          pageNumber={displayNumber}
          subpage={subpage}
          subpageCount={subpageCount}
          onPageEntry={handleDialPage}
          onPageStep={stepPage}
          onSubpageStep={stepSubpageBy}
          onFastext={handleSelectPage}
          compact={phone}
        >
          <TeletextGrid
            page={shownPage}
            pageNumber={displayNumber}
            subpage={subpage}
            subpageCount={subpageCount}
            readOnly
            onIndexPageSelect={handleSelectPage}
          />
        </CrtTelevision>

        {/*
          * Inside the column rather than beside it, because on a phone that is
          * where the leaflet lives: the set gives up the props, and what is
          * left is a band of table between the picture and the handset. The
          * book lies in it. On anything wider the drawer is `position: fixed`
          * and takes itself out of this flow again, back to the left edge.
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

export default SoloViewer;
