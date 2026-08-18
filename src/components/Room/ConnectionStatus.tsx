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

import { COPY } from '../../domain/copy';
import { DEFAULT_LANGUAGE } from '../../domain/landing';
import { useConnection } from '../../collab/useConnection';
import { useCopy } from './useCopy';

/*
 * The strings below are the copy table's entries for the default language, not
 * second copies of them.
 *
 * They exist because the tests name them, and because a test that spells the
 * words out again is a test that fails the day somebody rewords the interface —
 * which is exactly the change least worth failing over. Pointing them at
 * {@link COPY} means there is still one place the words live.
 */

/** The disconnected indicator text (Req 8.1). */
export const DISCONNECTED_LABEL = COPY[DEFAULT_LANGUAGE].connection.disconnected;

/**
 * Render the disconnected indicator while offline; render nothing when
 * connected.
 */
export function ConnectionStatus() {
  const { status } = useConnection();
  const copy = useCopy();

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
      {copy.connection.disconnected}
    </div>
  );
}

export default ConnectionStatus;
