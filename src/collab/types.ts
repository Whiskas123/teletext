/**
 * Shared collaborative data-model types for Collaborative Teletext Rooms.
 *
 * These types describe the room-scoped shared state persisted in the
 * playhtml / Yjs document (keyed per Room_ID), plus the ephemeral awareness
 * presence model. The underlying teletext data model (`Cell`, `TeletextPage`,
 * `TeletextColor`, `TOTAL_CELLS`) is reused unchanged from `src/types/teletext.ts`.
 */

import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../types/teletext';

// Re-export the reused teletext primitives so collab consumers have a single
// import surface for the shared data model.
export { TOTAL_CELLS };
export type { Cell, TeletextColor, TeletextPage };

/**
 * A teletext page stored as a map keyed by cell index (`0..959`).
 *
 * Storing pages this way (instead of a positional array) is the critical design
 * choice for cell-level conflict resolution: two members editing *different*
 * cells write *different* keys and both edits survive the CRDT merge, while two
 * members editing the *same* cell write the *same* key and converge
 * last-writer-wins. The positional {@link TeletextPage} used by the UI is
 * reconstructed from this map (missing keys become empty cells), which always
 * yields exactly {@link TOTAL_CELLS} cells.
 */
export type PageCellMap = Record<number, Cell>;

/**
 * Room synchronization shared state (playhtml id: `"room-sync"`).
 *
 * Holds the single currently displayed Page_Number shared by all members.
 * Defaults to page 100 when unset.
 */
export interface RoomSyncData {
  displayedPageNumber: number;
}

/**
 * Pages shared state (playhtml id: `"pages"`).
 *
 * Maps a Page_Number (`1..999`) to its {@link PageCellMap}. Absent keys denote
 * pages with no stored content (treated as empty).
 */
export type PagesData = Record<number, PageCellMap>;

/**
 * Titles shared state (playhtml id: `"titles"`).
 *
 * Maps a Page_Number (`1..999`) to its Page_Title. An absent key denotes a
 * Page_Title of length 0.
 */
export type TitlesData = Record<number, string>;

/**
 * A single chat comment authored by a member.
 */
export interface ChatMessage {
  /** Unique message id (uuid). */
  id: string;
  /** Stable client id of the author. */
  authorId: string;
  /** Author display name (Identity) captured at send time. */
  authorName: string;
  /** Author color (Identity) captured at send time. */
  authorColor: TeletextColor | string;
  /** Trimmed message text, 1..500 characters. */
  text: string;
  /** Author timestamp, epoch milliseconds. */
  ts: number;
}

/**
 * Chat shared state (playhtml id: `"chat"`).
 *
 * Messages are ordered chronologically ascending by {@link ChatMessage.ts}.
 */
export interface ChatData {
  messages: ChatMessage[];
}

/**
 * A single member's decision on the active Change_Request.
 */
export interface Vote {
  memberId: string;
  decision: 'accept' | 'reject';
}

/**
 * A pending proposal to change the room's displayed Page_Number, subject to
 * voting.
 */
export interface ChangeRequest {
  /** Unique change-request id. */
  id: string;
  /** Target Page_Number (`1..999`). */
  target: number;
  /** Stable client id of the requesting member. */
  requesterId: string;
  /** Count of members present at creation; fixed for the request's lifetime. */
  voteBase: number;
  /** Member ids present at creation; the only members eligible to vote. */
  eligibleMemberIds: string[];
  /** Recorded votes, keyed by member id. */
  votes: Record<string, 'accept' | 'reject'>;
  /** Creation timestamp, epoch milliseconds. */
  createdAt: number;
  /** Lifecycle status of the request. */
  status: 'active' | 'accepted' | 'rejected' | 'expired';
}

/**
 * Vote shared state (playhtml id: `"vote"`).
 *
 * Holds the single active Change_Request, or `null` when none is active.
 */
export interface VoteData {
  active: ChangeRequest | null;
}

/**
 * Ephemeral per-client presence (playhtml awareness; not persisted).
 */
export interface MemberPresence {
  /** Stable id for the member's session. */
  memberId: string;
  /**
   * Room_ID the member is currently present in. Presence lives on a single
   * global awareness channel, so consumers filter to the members whose
   * `roomId` matches the room they are watching.
   */
  roomId: string;
  /** Display name, 1..32 characters. */
  name: string;
  /** Assigned color from the room palette. */
  color: TeletextColor | string;
  /** Page_Number the member is editing, or `null` when not editing. */
  editingPageNumber: number | null;
  /** Cell index (`0..959`) of the member's cursor while editing, or `null`. */
  cursorIndex: number | null;
}

/**
 * Fixed room color palette used to assign a distinct color to each member.
 *
 * Derived from the non-black {@link TELETEXT_COLORS} subset plus additional
 * distinct hues so that a full room of members can each receive a recognizable
 * color. Colors are either {@link TeletextColor} names or CSS hex strings.
 */
export const ROOM_COLOR_PALETTE: readonly (TeletextColor | string)[] = [
  // Non-black teletext colors.
  ...TELETEXT_COLORS.filter((c) => c !== 'black'),
  // Additional distinct hues to extend capacity beyond the 7 teletext colors.
  '#ff8c00', // orange
  '#ff69b4', // hot pink
  '#7fff00', // chartreuse
  '#00ced1', // dark turquoise
  '#9370db', // medium purple
] as const;

/**
 * Maximum number of members a room can hold, matching the palette size so that
 * every present member is assigned a distinct color.
 */
export const ROOM_MAX_MEMBERS = ROOM_COLOR_PALETTE.length;
