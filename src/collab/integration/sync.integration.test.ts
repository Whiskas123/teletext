// Feature: collaborative-teletext-rooms — integration tests for sync, presence, and propagation.
//
// These tests validate the real-time sync/awareness behaviours that the design's
// Testing Strategy assigns to "integration tests (two simulated clients over a
// playhtml/Yjs test harness)": presence add/update/remove, page/message/title
// propagation, cursor propagation/removal, and connection/reconnect convergence.
//
// A full two-browser @playhtml/react harness needs a live playhtml relay server
// which is unavailable in CI. playhtml is built on Yjs (a CRDT) and Yjs is the
// exact mechanism the design relies on for propagation and conflict resolution
// (see design.md "Research summary" and "Room-scoped shared state"). We therefore
// exercise the same guarantees deterministically with TWO Y.Doc replicas whose
// updates are relayed to each other, mirroring our shared-state layout:
//   - 'room-sync'  Y.Map  { displayedPageNumber }
//   - 'pages'      Y.Map   -> per-page Y.Map keyed by cell index -> Cell
//   - 'titles'     Y.Map   Page_Number -> Page_Title
//   - 'chat'       Y.Array of ChatMessage
//   - presence     y-protocols Awareness keyed by memberId (ephemeral)
//
// _Requirements: 2.2, 2.4, 2.6, 3.2, 3.3, 5.4, 6.6, 6.8, 7.3, 7.8, 8.1, 8.2, 8.3, 8.4, 9.5_

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import type { Cell } from '../../types/teletext';
import type { ChatMessage, MemberPresence } from '../types';

/** Origin tag marking updates that arrived from the remote replica (never re-relayed). */
const REMOTE = 'remote';

/**
 * A two-replica harness that relays Yjs document updates *and* awareness updates
 * between doc A and doc B, modelling two playhtml clients sharing one room.
 *
 * The relay can be "disconnected" to simulate connection loss (Req 8.1/8.3/8.4):
 * while disconnected, updates produced on either side are buffered locally; on
 * reconnect the buffered updates are flushed both ways so the replicas converge
 * (Req 8.2/8.5).
 */
class TwoReplicaRoom {
  readonly docA = new Y.Doc();
  readonly docB = new Y.Doc();
  readonly awA = new Awareness(this.docA);
  readonly awB = new Awareness(this.docB);

  private connected = true;
  private bufferedForB: Uint8Array[] = [];
  private bufferedForA: Uint8Array[] = [];

  constructor() {
    // Relay document updates. Skip updates that originated from the remote side
    // to avoid an infinite echo loop; buffer while disconnected.
    this.docA.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      if (this.connected) Y.applyUpdate(this.docB, update, REMOTE);
      else this.bufferedForB.push(update);
    });
    this.docB.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      if (this.connected) Y.applyUpdate(this.docA, update, REMOTE);
      else this.bufferedForA.push(update);
    });

    // Relay awareness (presence) updates in both directions. Awareness is
    // ephemeral and not part of the document; it has its own update channel.
    this.awA.on('update', this.relayAwareness(this.awA, this.awB));
    this.awB.on('update', this.relayAwareness(this.awB, this.awA));
  }

  private relayAwareness(from: Awareness, to: Awareness) {
    return (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === REMOTE) return;
      if (!this.connected) return;
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      const enc = encodeAwarenessUpdate(from, changed);
      applyAwarenessUpdate(to, enc, REMOTE);
    };
  }

  /** Simulate connection loss: stop relaying and begin buffering local updates. */
  disconnect(): void {
    this.connected = false;
  }

  /** Simulate reconnect: flush buffered updates both ways so replicas converge. */
  reconnect(): void {
    this.connected = true;
    const toB = this.bufferedForB;
    const toA = this.bufferedForA;
    this.bufferedForB = [];
    this.bufferedForA = [];
    for (const u of toB) Y.applyUpdate(this.docB, u, REMOTE);
    for (const u of toA) Y.applyUpdate(this.docA, u, REMOTE);
    // Belt-and-suspenders: also reconcile any residual divergence via the
    // canonical Yjs state-vector exchange, matching how a real client resyncs.
    const diffToB = Y.encodeStateAsUpdate(this.docA, Y.encodeStateVector(this.docB));
    const diffToA = Y.encodeStateAsUpdate(this.docB, Y.encodeStateVector(this.docA));
    Y.applyUpdate(this.docB, diffToB, REMOTE);
    Y.applyUpdate(this.docA, diffToA, REMOTE);
  }

  destroy(): void {
    this.awA.destroy();
    this.awB.destroy();
    this.docA.destroy();
    this.docB.destroy();
  }
}

// ---------------------------------------------------------------------------
// Shared-state accessors mirroring the design's Room Yjs document layout.
// ---------------------------------------------------------------------------

function roomSync(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>('room-sync');
}

function pagesRoot(doc: Y.Doc): Y.Map<Y.Map<Cell>> {
  return doc.getMap<Y.Map<Cell>>('pages');
}

/**
 * Get (creating if needed) the per-page cell map keyed by cell index.
 *
 * Yjs serializes map keys as strings, so the Page_Number key must be a string
 * on every replica; using a number key would make a remote `get` miss the
 * synced entry and create a divergent nested map.
 */
function pageCellMap(doc: Y.Doc, pageNumber: number): Y.Map<Cell> {
  const pages = pagesRoot(doc);
  const key = String(pageNumber);
  let page = pages.get(key);
  if (!page) {
    page = new Y.Map<Cell>();
    pages.set(key, page);
  }
  return page;
}

function titles(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>('titles');
}

function chat(doc: Y.Doc): Y.Array<ChatMessage> {
  return doc.getArray<ChatMessage>('chat');
}

function memberPresence(overrides: Partial<MemberPresence> & { memberId: string }): MemberPresence {
  return {
    roomId: 'test-room',
    name: 'Guest-0001',
    color: 'cyan',
    editingPageNumber: null,
    cursorIndex: null,
    ...overrides,
  };
}

/** Collect present members from an Awareness instance as MemberPresence list. */
function presenceMembers(aw: Awareness): MemberPresence[] {
  return [...aw.getStates().values()]
    .map((s) => s as unknown as MemberPresence)
    .filter((s): s is MemberPresence => Boolean(s && s.memberId));
}

// ---------------------------------------------------------------------------

describe('Collaborative room sync integration (two Yjs replicas)', () => {
  let room: TwoReplicaRoom;

  beforeEach(() => {
    room = new TwoReplicaRoom();
  });

  afterEach(() => {
    room.destroy();
  });

  it('propagates a displayed page change from A to B (Req 3.2, 3.3)', () => {
    // A joins first and sets the room to page 250.
    roomSync(room.docA).set('displayedPageNumber', 250);
    // The change propagates to B (Req 3.2), and a member reading later sees it (Req 3.3).
    expect(roomSync(room.docB).get('displayedPageNumber')).toBe(250);

    // A subsequent change also propagates.
    roomSync(room.docB).set('displayedPageNumber', 314);
    expect(roomSync(room.docA).get('displayedPageNumber')).toBe(314);
  });

  it('preserves concurrent edits to DIFFERENT cells and converges SAME-cell edits deterministically (Req 6.2, 6.3)', () => {
    const PAGE = 100;
    // Seed the shared page so both replicas reference the same nested Y.Map.
    pageCellMap(room.docA, PAGE);

    // --- Different-cell concurrent edits: both survive. ---
    room.disconnect();
    pageCellMap(room.docA, PAGE).set('10', { char: 'A', fg: 'red', bg: 'black', graphics: null });
    pageCellMap(room.docB, PAGE).set('20', { char: 'B', fg: 'green', bg: 'black', graphics: null });
    room.reconnect();

    const cellsA = pageCellMap(room.docA, PAGE);
    const cellsB = pageCellMap(room.docB, PAGE);
    expect(cellsA.get('10')?.char).toBe('A');
    expect(cellsA.get('20')?.char).toBe('B');
    expect(cellsB.get('10')?.char).toBe('A');
    expect(cellsB.get('20')?.char).toBe('B');

    // --- Same-cell concurrent edits: converge to one identical value on both. ---
    room.disconnect();
    pageCellMap(room.docA, PAGE).set('30', { char: 'X', fg: 'yellow', bg: 'black', graphics: null });
    pageCellMap(room.docB, PAGE).set('30', { char: 'Y', fg: 'blue', bg: 'black', graphics: null });
    room.reconnect();

    const winnerA = pageCellMap(room.docA, PAGE).get('30');
    const winnerB = pageCellMap(room.docB, PAGE).get('30');
    // Deterministic convergence: both replicas agree on exactly one value.
    expect(winnerB).toEqual(winnerA);
    // And it is one of the two concurrent writes, not a merge artifact.
    expect(['X', 'Y']).toContain(winnerA?.char);
  });

  it('propagates a chat append from A to B in chronological order (Req 5.4, 7.3, 7.8)', () => {
    const m1: ChatMessage = {
      id: 'm1',
      authorId: 'a',
      authorName: 'Alice',
      authorColor: 'cyan',
      text: 'hello from A',
      ts: 1_000,
    };
    chat(room.docA).push([m1]);
    expect(chat(room.docB).toArray()).toHaveLength(1);
    expect(chat(room.docB).get(0)).toMatchObject({ text: 'hello from A', authorName: 'Alice' });

    // B replies; ordering by insertion (append) is preserved across replicas.
    const m2: ChatMessage = {
      id: 'm2',
      authorId: 'b',
      authorName: 'Bob',
      authorColor: 'red',
      text: 'hi from B',
      ts: 2_000,
    };
    chat(room.docB).push([m2]);
    expect(chat(room.docA).toArray().map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(chat(room.docB).toArray().map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('propagates a page-title write from A to B (Req 9.5, 7.8)', () => {
    titles(room.docA).set(String(200), 'Weather');
    expect(titles(room.docB).get(String(200))).toBe('Weather');

    // Concurrent same-title edits converge deterministically (Req 9.12-adjacent).
    room.disconnect();
    titles(room.docA).set(String(200), 'Weather A');
    titles(room.docB).set(String(200), 'Weather B');
    room.reconnect();
    expect(titles(room.docB).get(String(200))).toBe(titles(room.docA).get(String(200)));
  });

  it('adds a member on connect and drops it on disconnect via awareness (Req 2.2, 2.6, 6.8)', () => {
    // Member on A connects and publishes presence.
    room.awA.setLocalState(memberPresence({ memberId: 'alice', name: 'Alice', color: 'cyan' }));
    // Presence appears on B (Req 2.2).
    let onB = presenceMembers(room.awB);
    expect(onB.map((m) => m.memberId)).toContain('alice');
    expect(onB.find((m) => m.memberId === 'alice')?.name).toBe('Alice');

    // Member on A publishes a cursor position (Req 6.6): update propagates.
    room.awA.setLocalState(
      memberPresence({ memberId: 'alice', name: 'Alice', color: 'cyan', editingPageNumber: 100, cursorIndex: 42 }),
    );
    onB = presenceMembers(room.awB);
    expect(onB.find((m) => m.memberId === 'alice')?.cursorIndex).toBe(42);

    // Member on A disconnects: awareness state is removed and drops on B
    // (Req 2.6 presence removal, Req 6.8 cursor removal).
    removeAwarenessStates(room.awA, [room.docA.clientID], 'local');
    onB = presenceMembers(room.awB);
    expect(onB.map((m) => m.memberId)).not.toContain('alice');
  });

  it('updates a member display name for the other member (Req 2.4)', () => {
    room.awA.setLocalState(memberPresence({ memberId: 'alice', name: 'Guest-0001', color: 'cyan' }));
    expect(presenceMembers(room.awB).find((m) => m.memberId === 'alice')?.name).toBe('Guest-0001');

    // Alice renames herself; the change propagates to B within the sync channel.
    room.awA.setLocalState(memberPresence({ memberId: 'alice', name: 'Alice', color: 'cyan' }));
    expect(presenceMembers(room.awB).find((m) => m.memberId === 'alice')?.name).toBe('Alice');
  });

  it('retains last page while disconnected and re-syncs on reconnect (Req 8.1, 8.2, 8.3, 8.4)', () => {
    // Both members agree on page 100 initially.
    roomSync(room.docA).set('displayedPageNumber', 100);
    expect(roomSync(room.docB).get('displayedPageNumber')).toBe(100);

    // Connection is lost.
    room.disconnect();

    // While disconnected, A changes the shared page and edits a cell locally;
    // B does NOT see the change yet but retains its last known page (Req 8.3).
    roomSync(room.docA).set('displayedPageNumber', 500);
    pageCellMap(room.docA, 500).set('0', { char: 'Z', fg: 'white', bg: 'black', graphics: null });
    expect(roomSync(room.docB).get('displayedPageNumber')).toBe(100);

    // B also keeps editing locally while offline (Req 8.4).
    pageCellMap(room.docB, 100).set('5', { char: 'Q', fg: 'red', bg: 'black', graphics: null });

    // Reconnect: buffered updates flush both ways and replicas converge (Req 8.2, 8.5).
    room.reconnect();

    // Shared displayed page re-syncs on B.
    expect(roomSync(room.docB).get('displayedPageNumber')).toBe(500);
    expect(roomSync(room.docA).get('displayedPageNumber')).toBe(500);
    // Both offline edits survived and converged on both replicas.
    expect(pageCellMap(room.docB, 500).get('0')?.char).toBe('Z');
    expect(pageCellMap(room.docA, 100).get('5')?.char).toBe('Q');
    expect(pageCellMap(room.docB, 100).get('5')?.char).toBe('Q');
  });

  it('converges same-cell edits made concurrently during a disconnect (Req 8.5)', () => {
    const PAGE = 300;
    pageCellMap(room.docA, PAGE);
    // Ensure both replicas share the nested page map before disconnecting.
    expect(pagesRoot(room.docB).get(String(PAGE))).toBeDefined();

    room.disconnect();
    pageCellMap(room.docA, PAGE).set('7', { char: 'L', fg: 'green', bg: 'black', graphics: null });
    pageCellMap(room.docB, PAGE).set('7', { char: 'R', fg: 'magenta', bg: 'black', graphics: null });
    room.reconnect();

    const a = pageCellMap(room.docA, PAGE).get('7');
    const b = pageCellMap(room.docB, PAGE).get('7');
    expect(b).toEqual(a); // one deterministic winner, identical on both
    expect(['L', 'R']).toContain(a?.char);
  });
});
