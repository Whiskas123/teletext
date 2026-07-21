/**
 * ConnectionStatus — surfaces the room's connection state to the member.
 *
 * Design notes (see design.md "Connection lost / Reconnect" and Req 8):
 * - Reads the derived status from {@link useConnection}.
 * - When `status === 'disconnected'`, renders a visible disconnected indicator
 *   (Req 8.1).
 * - When `status === 'connected'`, renders nothing so the indicator is hidden
 *   once the room document has synced (Req 8.2).
 *
 * The indicator uses `role="status"` with `aria-live="assertive"` so assistive
 * technologies announce the connection loss without the member needing to look
 * for it.
 *
 * Requirements: 8.1, 8.2.
 */

import { useConnection } from '../../collab/useConnection';

/**
 * The disconnected indicator text (Req 8.1).
 */
export const DISCONNECTED_LABEL = 'Disconnected — reconnecting…';

/**
 * Render the disconnected indicator while offline; render nothing when
 * connected.
 */
export function ConnectionStatus() {
  const { status } = useConnection();

  if (status === 'connected') {
    // Hidden when connected (Req 8.2).
    return null;
  }

  return (
    <div
      className="connection-status connection-status-disconnected"
      role="status"
      aria-live="assertive"
    >
      <span className="connection-status-dot" aria-hidden="true" />
      {DISCONNECTED_LABEL}
    </div>
  );
}

export default ConnectionStatus;
