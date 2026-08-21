import { useState } from 'react';
import { useLocalizedNavigate as useNavigate } from './useLocalizedNavigate';
import { useRoomOccupancy } from '../../collab/useRoomOccupancy';
import { useOccupiedPages } from '../../collab/useOccupiedPages';
import { firstFreePlaygroundPage } from '../../domain/access';
import {
  LANDING_COPY,
  MENU,
  PROJECT_NAME,
  PROJECT_NAME_LINES,
  type MenuEntry,
} from '../../domain/landing';
import { ROOMS } from './rooms';
import { FrontpageShowcase } from './FrontpageShowcase';
import { useLanguage } from './useLanguage';


/**
 * Landing — the app's entry screen shown at `/`.
 *
 * A teletext service opened on a coloured index, and so does this: the wordmark
 * top left, the language switch top right, and four words down the left in the
 * palette's colours. Nothing else. The restraint is the design — a front page
 * with cards and paragraphs on it is a website about teletext, whereas four
 * coloured words on black is the thing itself.
 *
 * The ways in:
 *  - **ver** — reveals the choice of watching alone (`/watch`) or in one of the
 *    six fixed rooms (`/room/:roomId`). Both are watching, so both live under
 *    one word rather than competing for the front page — but they are two kinds
 *    of watching, so each kind is named and the rooms hang off their name. Laid
 *    out flat, as seven identical chips in a row, "sozinho" read as a seventh
 *    room and the house names said nothing about anyone else being there.
 *  - **criar** — the solo editor, opened on the first *free* playground page
 *    rather than the editor's default. Landing everyone on the same number
 *    meant two people creating a page at once overwrote each other's work.
 *  - **guestbook** — the book of signatures (`/guestbook`): a name and eight
 *    rows of teletext, left for whoever comes next.
 *  - **sobre** — the about page (`/about`), which is the only prose on the site.
 *
 * Nothing here asks for a name. Members start as `Guest-XXXX` and rename
 * themselves from the room sidebar if they care to.
 */

export { PROJECT_NAME };

export function Landing() {
  const navigate = useNavigate();
  const { language, other, toggle } = useLanguage();
  const copy = LANDING_COPY[language];

  // Which entry has its detail open. Only "ver" has one — the watch choices.
  const [openEntry, setOpenEntry] = useState<MenuEntry['id'] | null>(null);

  const occupancy = useRoomOccupancy(ROOMS.map((r) => r.id));
  const occupiedPages = useOccupiedPages();

  /**
   * Open the editor on a blank page.
   *
   * Resolved at click time rather than on render: by then the live document has
   * had the whole time the landing screen was on screen to sync, so the answer
   * reflects what is actually taken. Navigating with an explicit page number
   * also means the editor never has to re-decide and shift under the user once
   * more pages arrive.
   *
   * With the playground full there is no blank page to offer, so the editor
   * opens on its own default and says so there.
   */
  function handleCreatePage() {
    const free = firstFreePlaygroundPage(occupiedPages);
    navigate(free == null ? '/edit' : `/edit/${free}`);
  }

  function handleChoose(entry: MenuEntry) {
    switch (entry.action) {
      case 'watch':
        setOpenEntry((open) => (open === entry.id ? null : entry.id));
        return;
      case 'create':
        handleCreatePage();
        return;
      case 'about':
        navigate('/about');
        return;
      case 'guestbook':
        navigate('/guestbook');
        return;
      case 'pending':
        // Deliberately nothing. The entry is marked `aria-disabled` below, so
        // this is never reached by anyone who was told what it does.
        return;
    }
  }

  return (
    <div className="frontpage">
      <header className="frontpage-head">
        {/*
          * A column of two things: the title row, and the line under it.
          *
          * The logo is centred against the name because they share that row, and
          * the tagline starts at the column's own left edge — which is the logo's
          * — so neither alignment needs a number that tracks the other.
          */}
        <div className="frontpage-mark">
          <div className="frontpage-title">
            <img src="/logo.png" alt="" className="frontpage-logo" aria-hidden="true" />
            {/* The break is part of the wordmark, not the viewport's opinion. */}
            <h1 className="frontpage-name">
              <span className="sr-only">{PROJECT_NAME}</span>
              {PROJECT_NAME_LINES.map((line) => (
                <span key={line} className="frontpage-name-line" aria-hidden="true">
                  {line}
                </span>
              ))}
            </h1>
          </div>
          {/* An apposition to the name, so it reads as part of the wordmark
              rather than as a paragraph the page has grown. */}
          <p className="frontpage-tagline">{copy.tagline}</p>
        </div>

        {/*
          * The language switch reads as one control, `PT/EN`, with the current
          * language lit. One button rather than two, because with exactly two
          * languages "switch" and "choose the other one" are the same act — and
          * a pair of buttons would leave the visitor deciding which of them is
          * already true.
          */}
        <button
          type="button"
          className="frontpage-lang"
          onClick={toggle}
          aria-label={`${copy.languageSwitch}: ${language.toUpperCase()} — ${other.toUpperCase()}`}
        >
          <span className="frontpage-lang-on">{language.toUpperCase()}</span>
          <span className="frontpage-lang-sep" aria-hidden="true">
            /
          </span>
          <span className="frontpage-lang-off">{other.toUpperCase()}</span>
        </button>
      </header>

      {/*
        * The band between the wordmark and the menu, which the mockup leaves
        * empty on the left and wholly empty on the right. One real page on air
        * goes there: the composition already had a page-shaped hole in it, and
        * a page says what this is faster than a paragraph about teletext could.
        */}
      <div className="frontpage-band">
        <FrontpageShowcase
          label={copy.onAir}
          pageWord={copy.pageWord}
          onSelect={(pageNumber, subpage) => navigate(`/watch/${pageNumber}/${subpage}`)}
        />
      </div>

      <nav className="frontpage-menu" aria-label={copy.menu}>
        <ul className="frontpage-menu-list">
          {MENU.map((entry) => {
            const pending = entry.action === 'pending';
            const open = openEntry === entry.id;
            return (
              <li key={entry.id} className="frontpage-menu-item">
                <button
                  type="button"
                  className={`frontpage-menu-btn teletext-fg-${entry.color}${
                    pending ? ' frontpage-menu-btn-pending' : ''
                  }`}
                  onClick={() => handleChoose(entry)}
                  // The word alone is terse to hear read out, so the hint says
                  // what choosing it does. A pending entry says that instead of
                  // promising something it cannot do.
                  aria-label={
                    pending
                      ? `${entry.label[language]} — ${copy.comingSoon}`
                      : entry.hint[language]
                  }
                  aria-disabled={pending || undefined}
                  aria-expanded={entry.action === 'watch' ? open : undefined}
                  aria-controls={entry.action === 'watch' ? 'frontpage-watch' : undefined}
                >
                  {entry.label[language]}
                  {/* A pending entry keeps its full colour, so the index reads
                      as the four-word index it is — and says what it is on
                      hover and focus, where a sighted visitor is about to find
                      out the hard way. Screen readers get it from the label
                      above, which is why this is decoration. */}
                  {pending && (
                    <span className="frontpage-menu-soon" aria-hidden="true">
                      {copy.comingSoon}
                    </span>
                  )}
                </button>

                {open && entry.action === 'watch' && (
                  <div id="frontpage-watch" className="frontpage-submenu">
                    {/*
                      * Watching alone has nothing to choose inside it, so its
                      * name is the door itself. Its note is tied to the button
                      * by `aria-describedby` rather than folded into the label:
                      * the name of the choice is the word, and "só tu" is what
                      * is said about it.
                      */}
                    <div className="frontpage-watch-group">
                      <button
                        type="button"
                        className="frontpage-watch-kind"
                        onClick={() => navigate('/watch')}
                        aria-describedby="frontpage-watch-alone-note"
                      >
                        {copy.watchAlone}
                      </button>
                      <p className="frontpage-watch-note" id="frontpage-watch-alone-note">
                        {copy.watchAloneNote}
                      </p>
                    </div>

                    {/*
                      * The rooms are a set of doors, so their kind is a heading
                      * and the six hang off it. Named as a group as well as
                      * drawn as one, so it is a set of six rooms heard as well
                      * as seen — otherwise the house names arrive as six loose
                      * buttons with nothing saying who is behind them.
                      */}
                    <div className="frontpage-watch-group">
                      <p
                        className="frontpage-watch-kind teletext-fg-cyan"
                        id="frontpage-watch-rooms-name"
                      >
                        {copy.watchTogether}
                      </p>
                      <p className="frontpage-watch-note" id="frontpage-watch-rooms-note">
                        {copy.watchTogetherNote}
                      </p>
                      <div
                        className="frontpage-watch-rooms"
                        role="group"
                        aria-labelledby="frontpage-watch-rooms-name frontpage-watch-rooms-note"
                      >
                        {ROOMS.map((room) => {
                          const count = occupancy[room.id] ?? 0;
                          return (
                            <button
                              key={room.id}
                              type="button"
                              className="frontpage-sub-btn"
                              onClick={() => navigate(`/room/${room.id}`)}
                              aria-label={`${copy.watchTogether}: ${room.label}`}
                            >
                              {room.label}
                              {/* Live occupancy, so a room with people in it is
                                  the obvious one to join rather than a guess. */}
                              <span
                                className={`frontpage-sub-count${
                                  count > 0 ? ' frontpage-sub-count-live' : ''
                                }`}
                              >
                                {count > 0 ? `${count} ${copy.watching}` : copy.empty}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default Landing;
