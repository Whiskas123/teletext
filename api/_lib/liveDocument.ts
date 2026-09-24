/**
 * Reading the live playhtml document from the server — read-only.
 *
 * The pages live on playhtml's host as one Yjs document per site address and
 * room. There is no HTTP API for it: the only way to get it is to connect as a
 * client and receive it, which is what every browser does. This does the same
 * from a serverless function, so the daily job can copy what visitors wrote in
 * the playground even when no moderator's browser is open to mirror it.
 *
 * ## It never writes
 *
 * Any change to the local copy that did not arrive from the server would be
 * this code writing into the live service. The document is watched for exactly
 * that, and the read fails rather than letting one reach the connection. No
 * presence is announced, and the connection is closed as soon as the document
 * has arrived.
 *
 * ## It depends on playhtml's internals, and says so when they move
 *
 * None of this is a public interface: the room name (`<host>-<room>`), the
 * `play.__page__` layout the React hooks store their channels under, and the
 * reset handshake — the server answers a first connection with a `room-reset`
 * message carrying an epoch and closes it, and the client must reconnect with
 * that epoch — were all read out of playhtml's bundle and confirmed against the
 * live service. When any of them stops holding, this throws a
 * {@link LiveDocumentError} naming which, and the daily job records it as a
 * failure instead of reporting a backup it did not take.
 */

import WebSocket from 'ws';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

import type { LiveChannels } from '../../src/domain/liveMirror';
import { SOURCES_CHANNEL } from '../../src/domain/pageSource';
import { SUBPAGE_COUNTS_CHANNEL } from '../../src/domain/subpages';

/** playhtml's own host, as its bundle defaults to. */
export const PLAYHTML_HOST = 'playhtml.spencerc99.workers.dev';

/** The room `GlobalProvider` joins; playhtml prefixes the site's host. */
export const PLAYHTML_ROOM = 'teletext-house';

/**
 * Channel ids, as the collab hooks name them. Restated rather than imported:
 * those modules pull in React. `liveDocument.test.ts` checks they agree.
 */
export const CHANNELS = {
  pages: 'pages',
  titles: 'titles',
  kinds: 'page-kinds',
  descriptions: 'descriptions',
  counts: SUBPAGE_COUNTS_CHANNEL,
  sources: SOURCES_CHANNEL,
} as const;

export type LiveDocumentFailure =
  | 'timeout'
  | 'reset-loop'
  | 'local-change'
  | 'layout'
  | 'connection';

export class LiveDocumentError extends Error {
  readonly reason: LiveDocumentFailure;

  constructor(reason: LiveDocumentFailure, message: string) {
    super(message);
    this.name = 'LiveDocumentError';
    this.reason = reason;
  }
}

/** playhtml's room name for a site address: `<host without www>-<room>`, encoded. */
export function roomName(siteHost: string, room: string = PLAYHTML_ROOM): string {
  return encodeURIComponent(`${siteHost.replace(/^www\./i, '')}-${room}`);
}

/**
 * The page channels out of a received document, checked.
 *
 * Throws `layout` when the document does not have the shape the site writes:
 * no `play.__page__` map, or no `pages` channel in it. An empty document from a
 * room that exists but was never written reads the same as a layout that moved,
 * and both must stop the copy rather than feed it nothing.
 */
export function readChannels(doc: Y.Doc): LiveChannels {
  const play = doc.getMap('play');
  const page = play.get('__page__');
  if (!(page instanceof Y.Map)) {
    throw new LiveDocumentError(
      'layout',
      `The live document has no play.__page__ map (keys: ${[...play.keys()].join(', ') || 'none'}). ` +
        'playhtml may have changed how it stores page data.',
    );
  }
  const channels = page.toJSON() as Record<string, unknown>;
  const object = (id: string): Record<string, unknown> => {
    const value = channels[id];
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };
  const pages = object(CHANNELS.pages);
  if (Object.keys(pages).length === 0) {
    throw new LiveDocumentError(
      'layout',
      'The live document has no pages. Either the room is new or playhtml changed where it keeps them.',
    );
  }
  return {
    pages,
    titles: object(CHANNELS.titles),
    kinds: object(CHANNELS.kinds) as LiveChannels['kinds'],
    descriptions: object(CHANNELS.descriptions),
    counts: object(CHANNELS.counts) as LiveChannels['counts'],
    sources: object(CHANNELS.sources),
  };
}

export interface LiveDocumentRead {
  channels: LiveChannels;
  /** Size of the whole document with its history, for noticing growth. */
  bytes: number;
  ms: number;
}

/** One connection: resolves with the synced document, or the epoch to retry with. */
function connectOnce(
  host: string,
  room: string,
  epoch: number | null,
  timeoutMs: number,
): Promise<{ doc: Y.Doc } | { epoch: number }> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    let settled = false;
    const provider = new YProvider(host, room, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
      params: {
        sharedElements: '[]',
        sharedReferences: '[]',
        clientResetEpoch: epoch == null ? null : String(epoch),
      },
    });
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      provider.destroy();
      outcome();
    };

    // Everything the server sends arrives with the provider as its origin;
    // anything else would be this code writing.
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider) {
        finish(() =>
          reject(new LiveDocumentError('local-change', 'Refused: the read would have changed the live document.')),
        );
      }
    });

    // Not a visitor: no presence, no cursor, no entry in anyone's room.
    provider.awareness.setLocalState(null);

    provider.on('custom-message', (message: string) => {
      try {
        const body = JSON.parse(message) as { type?: string; resetEpoch?: unknown };
        if (body.type === 'room-reset') {
          const next = Number(body.resetEpoch);
          finish(() =>
            Number.isFinite(next)
              ? resolve({ epoch: next })
              : reject(new LiveDocumentError('reset-loop', 'The server asked for a reset without an epoch.')),
          );
        }
      } catch {
        // Other custom messages (permissions, events) are not ours to read.
      }
    });

    provider.on('sync', (synced: boolean) => {
      if (synced) finish(() => resolve({ doc }));
    });

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new LiveDocumentError('timeout', `The live document did not arrive within ${timeoutMs / 1000} s.`)),
        ),
      timeoutMs,
    );
  });
}

/**
 * Connect, follow the reset handshake if the server asks for it, receive the
 * document, disconnect, and return its page channels.
 */
export async function readLiveDocument({
  siteHost,
  host = PLAYHTML_HOST,
  timeoutMs = 25_000,
}: {
  siteHost: string;
  host?: string;
  timeoutMs?: number;
}): Promise<LiveDocumentRead> {
  const room = roomName(siteHost);
  const started = Date.now();
  let epoch: number | null = null;

  // A reset asks for exactly one reconnect. Three means something has changed
  // in how playhtml does this, and looping would only hide it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let outcome: { doc: Y.Doc } | { epoch: number };
    try {
      outcome = await connectOnce(host, room, epoch, timeoutMs);
    } catch (error) {
      if (error instanceof LiveDocumentError) throw error;
      throw new LiveDocumentError(
        'connection',
        error instanceof Error ? error.message : 'Could not connect to the live document.',
      );
    }
    if ('epoch' in outcome) {
      epoch = outcome.epoch;
      continue;
    }
    return {
      channels: readChannels(outcome.doc),
      bytes: Y.encodeStateAsUpdate(outcome.doc).length,
      ms: Date.now() - started,
    };
  }
  throw new LiveDocumentError('reset-loop', 'The live document kept asking to be reset.');
}
