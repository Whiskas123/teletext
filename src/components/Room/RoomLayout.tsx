/**
 * RoomLayout — the structural shell shared by every in-room screen.
 *
 * - RoomLayout is a reusable, content-agnostic shell. It does NOT import the
 *   viewer or the chat/vote/guide panels directly; instead it exposes two slots
 *   so each page composes the pieces it needs:
 *     - `children` — the main content area (e.g. RoomViewer).
 *     - `sidebar`  — optional extra panels (e.g. ChatSidebar, VotePanel, TVGuide)
 *       supplied by the consuming page.
 * - It renders the room chrome common to every in-room screen: the Room name,
 *   the {@link ConnectionStatus} disconnected indicator (Req 8.1/8.2), and the
 *   {@link PresenceList} of present members (Req 2.3/2.7/2.8).
 */

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import ConnectionStatus from './ConnectionStatus';
import PresenceList from './PresenceList';

export interface RoomLayoutProps {
  /** The Room's Room_ID, shown as the room name. */
  roomId: string;
  /**
   * The main content area of the room — typically the viewer. Slotted by the
   * consuming page so RoomLayout stays content-agnostic.
   */
  children: ReactNode;
  /**
   * Optional sidebar content — extra panels such as chat, voting, or the TV
   * Guide. Supplied by the consuming page.
   */
  sidebar?: ReactNode;
}

/**
 * Render the common room shell around a page-supplied main content area and an
 * optional sidebar.
 */
export function RoomLayout({ roomId, children, sidebar }: RoomLayoutProps) {
  return (
    <div className="room-layout">
      <header className="room-layout-header">
        <Link to="/" className="room-back-link">
          &lt; Back to home
        </Link>
        <div className="room-id-display">
          <span className="room-id-label">Room</span>
          <code className="room-id-value">{roomId}</code>
        </div>
        <ConnectionStatus />
      </header>

      <div className="room-layout-body">
        <main className="room-layout-main">{children}</main>

        <aside className="room-layout-sidebar" aria-label="Room panels">
          {/* Name is chosen on the landing page and locked while in a room. */}
          <PresenceList allowRename={false} />
          {sidebar}
        </aside>
      </div>
    </div>
  );
}

export default RoomLayout;
