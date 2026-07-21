/**
 * RoomContext — carries the current Room_ID down to the room-scoped
 * collaborative hooks.
 *
 * With the move to a single global playhtml document (see {@link GlobalProvider}),
 * room-specific shared state is no longer isolated by the provider namespace;
 * instead each room's channels are keyed by Room_ID (e.g. `chat:${roomId}`).
 * The room screens ({@link RoomViewer}) provide this context around their
 * subtree so the hooks ({@link useRoomSync}, {@link useChat}, {@link useVoting},
 * {@link usePresence}) can read the active Room_ID via {@link useRoomId} without
 * every call site threading a `roomId` prop.
 */

import { createContext, useContext } from 'react';

/**
 * Context holding the active Room_ID, or `null` when no room is in scope (e.g.
 * on the landing page or the solo editor, which are not room-scoped).
 */
export const RoomContext = createContext<string | null>(null);

/**
 * Read the active Room_ID from {@link RoomContext}.
 *
 * @throws if called outside a {@link RoomContext} provider (a programming
 * error: a room-scoped hook was used on a non-room screen).
 */
export function useRoomId(): string {
  const roomId = useContext(RoomContext);
  if (roomId == null) {
    throw new Error(
      'useRoomId must be used within a RoomContext provider (a room-scoped ' +
        'hook was used outside a room).',
    );
  }
  return roomId;
}
