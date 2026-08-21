/**
 * RoomLayout — the structural shell shared by every watching screen.
 *
 * - RoomLayout is a reusable, content-agnostic shell. It does NOT import the
 *   viewer or the chat/presence/vote/guide panels directly; instead it exposes
 *   two slots so each page composes the pieces it needs:
 *     - `children` — the main content area (e.g. RoomViewer).
 *     - `sidebar`  — optional panels (e.g. PresenceList + ChatSidebar) supplied
 *       by the consuming page. Omitted entirely by the solo viewer, which has
 *       no room-scoped context for those panels to read.
 * - It renders the chrome common to every watching screen: the back link, the
 *   screen's name (a Room_ID, or a plain `title` for the solo viewer), and the
 *   {@link ConnectionStatus} disconnected indicator (Req 8.1/8.2).
 */

import { type ReactNode } from 'react';
import { Link } from './LocalizedLink';

import ConnectionStatus from './ConnectionStatus';
import { useCopy } from './useCopy';

export interface RoomLayoutProps {
  /**
   * The Room's Room_ID, shown as the room name. Omitted outside a room (the
   * solo viewer), in which case `title` names the screen instead.
   */
  roomId?: string;
  /**
   * Screen name shown when there is no `roomId` — e.g. "Watch solo". Ignored
   * when `roomId` is set.
   */
  title?: string;
  /**
   * The main content area — typically the viewer. Slotted by the consuming page
   * so RoomLayout stays content-agnostic.
   */
  children: ReactNode;
  /**
   * Optional sidebar content — the presence list, chat, voting, or the TV
   * Guide. Supplied by the consuming page; when omitted no sidebar is rendered.
   */
  sidebar?: ReactNode;
}

/**
 * Render the common watching shell around a page-supplied main content area and
 * an optional sidebar.
 */
export function RoomLayout({ roomId, title, children, sidebar }: RoomLayoutProps) {
  const copy = useCopy();

  return (
    <div className="room-layout">
      <header className="room-layout-header">
        <Link to="/" className="room-back-link" aria-label={copy.layout.backHome}>
          <span className="room-back-arrow">&lt;</span>
          <img src="/logo.png" alt="" className="room-back-logo" />
        </Link>
        <div className="room-id-display">
          {roomId != null ? (
            <>
              <span className="room-id-label">{copy.layout.room}</span>
              <code className="room-id-value">{roomId}</code>
            </>
          ) : (
            <span className="room-id-label">{title}</span>
          )}
        </div>
        <ConnectionStatus />
      </header>

      <div className="room-layout-body">
        <main className="room-layout-main">{children}</main>

        {sidebar != null && (
          <aside className="room-layout-sidebar" aria-label={copy.layout.panels}>
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  );
}

export default RoomLayout;
