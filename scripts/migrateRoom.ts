/**
 * Move the live playhtml document from one deployment host to another.
 *
 *     bun run room:migrate --from old.example.com --to new.example.com
 *     bun run room:migrate --from old.example.com --to new.example.com --apply
 *
 * ## Why two hosts have two sets of pages
 *
 * `GlobalProvider` mounts playhtml with a fixed room name, `teletext-house`.
 * That is *not* the room playhtml actually connects to. Inside the library the
 * effective name is built from the browser's own hostname (see the `Fn` helper
 * in `playhtml/dist/playhtml.es.js`, and {@link roomNameFor} below, which is a
 * transcription of it):
 *
 *     encodeURIComponent(host.replace(/^www\./i, '') + '-' + room)
 *
 * So `old.example.com` and `new.example.com` are two entirely separate Yjs
 * documents on playhtml's PartyKit server, and nothing in the configuration can
 * make them the same one — the host prefix is not overridable. Postgres being
 * shared changes nothing, because Postgres holds the archive corpus and the
 * backup, while everything a visitor reads or edits lives in the live document
 * (`src/collab/useSnapshot.ts` explains that split).
 *
 * Two hosts are therefore two libraries, and moving between them means copying
 * the document. That is what this does.
 *
 * ## Why this can run outside a browser, when the snapshot cannot
 *
 * `useSnapshot` has to run in the browser because it reads the document through
 * playhtml, and playhtml only exists once a page has mounted it. The document
 * itself is just Yjs over a WebSocket, and the room name is computable from the
 * hostname without a browser at all — so this connects to both rooms directly
 * with the same provider playhtml uses internally, and never loads the app.
 *
 * ## What it copies, and what it deliberately does not
 *
 * By default: the six channels that hold content —
 * {@link CONTENT_CHANNELS}. Each is replaced wholesale on the destination
 * rather than merged, so a page that exists on both sides ends up as the
 * source's copy, not an interleaving of the two.
 *
 * Not by default:
 * - `presence:*` — who is in a room *right now*. Copied, it would seat ghosts
 *   in every room on the new host. `--all-channels` does not override this.
 * - `chat:*` — the rooms' transcripts. `--with-chat` brings them along.
 * - `vote:*`, `room-sync:*` — a half-finished ballot, and which page a room
 *   happened to be showing. These are the state of a sitting rather than
 *   anything about the pages; `--all-channels` takes them, `--only` names an
 *   exact set.
 *
 * ## Nothing is destroyed without a copy on disk first
 *
 * Every run — including a dry run — writes both documents to
 * `--backup-dir` as Yjs updates before touching anything. Re-applying one is
 * `Y.applyUpdate(doc, readFileSync(file))` against the same room, so a mistake
 * here is reversible. A dry run is the default; `--apply` is required to write.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

/**
 * playhtml's hosted PartyKit server — the value `Lm()` in the bundle falls back
 * to for any host that is not staging or an ngrok tunnel.
 */
const PARTYKIT_HOST = 'playhtml.spencerc99.workers.dev';

/**
 * The room passed to `PlayProvider` in {@link ../src/collab/GlobalProvider}.
 * Kept as a literal rather than imported: that module pulls in React and
 * react-router, which have no business being loaded by a CLI script.
 */
const DEFAULT_ROOM = 'teletext-house';

/**
 * Where playhtml keeps `usePageData` channels inside the document: the synced
 * store's `play` map, under a single reserved key (`le` in the bundle).
 */
const STORE_MAP = 'play';
const PAGE_DATA_KEY = '__page__';

/**
 * The channels that hold what a visitor reads. Everything here is global —
 * none of them is keyed by Room_ID — which is why moving them moves the whole
 * library in one step.
 */
const CONTENT_CHANNELS = [
  'pages', // src/collab/useEditPage.ts   — every page's cells, keyed by pageKey
  'titles', // src/collab/useGuide.ts      — page titles
  'page-kinds', // src/collab/usePageKinds.ts  — page vs heading
  'descriptions', // src/collab/usePageText.ts   — directory descriptions
  'subpage-counts', // src/domain/subpages.ts      — how many screens a carousel has
  'guestbook', // src/collab/useGuestbook.ts  — visitors' signatures
] as const;

/** Channels never copied even under `--all-channels`: see the header. */
const NEVER_COPY = /^presence:/;

/** A room's chat transcript, one channel per Room_ID — `--with-chat` adds these. */
const CHAT_CHANNEL = /^chat:/;

/** How long to wait for a room to sync before giving up on it. */
const SYNC_TIMEOUT_MS = 30_000;

/** How many `room-reset` round trips to follow before calling it a loop. */
const MAX_RESET_ROUNDS = 5;

/** How long to wait for one channel's update to leave the send buffer. */
const FLUSH_TIMEOUT_MS = 60_000;

/** A beat after the buffer drains, for the server to receive and persist. */
const FLUSH_SETTLE_MS = 1_000;

/** How many times to re-read the destination before calling the write failed. */
const VERIFY_ROUNDS = 3;
const VERIFY_RETRY_MS = 5_000;

interface Options {
  from: string;
  to: string;
  room: string;
  apply: boolean;
  only: string[] | null;
  allChannels: boolean;
  withChat: boolean;
  backupDir: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    return next;
  };

  const from = value('--from');
  const to = value('--to');
  if (from == null || to == null) {
    throw new Error(
      'Usage: bun run scripts/migrateRoom.ts --from <old host> --to <new host> [--apply]',
    );
  }

  const only = value('--only');
  return {
    from: hostOf(from),
    to: hostOf(to),
    room: value('--room') ?? DEFAULT_ROOM,
    apply: argv.includes('--apply'),
    only: only == null ? null : only.split(',').map((name) => name.trim()).filter(Boolean),
    allChannels: argv.includes('--all-channels'),
    withChat: argv.includes('--with-chat'),
    backupDir: value('--backup-dir') ?? 'room-backups',
  };
}

/**
 * The host part of whatever the operator typed. A full URL is accepted because
 * that is what one has to hand — it is the address bar, not a hostname, that
 * distinguishes the two deployments.
 */
function hostOf(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).host;
  } catch {
    throw new Error(`Not a host or URL: ${input}`);
  }
}

/**
 * playhtml's room name for a given browser host, transcribed from `Fn`/`Lg` in
 * the bundle. `www.` is stripped; an empty host becomes `LOCAL`.
 *
 * This is the one piece that has to stay in step with the library. If a
 * playhtml upgrade ever changes it, every page appears to vanish at once —
 * which is loud enough to notice, and the fix is here.
 */
export function roomNameFor(host: string, room: string): string {
  const domain = host ? host.replace(/^www\./i, '') : 'LOCAL';
  return encodeURIComponent(room === '' ? domain : `${domain}-${room}`);
}

interface Connection {
  doc: Y.Doc;
  provider: YProvider;
  roomName: string;
  label: string;
}

/**
 * One attempt at a room, at a given reset epoch.
 *
 * Resolves with the epoch the server demanded instead, when it turns out to
 * want a different one — see {@link connect}.
 */
async function attempt(
  roomName: string,
  epoch: number | null,
): Promise<
  | { outcome: 'synced'; doc: Y.Doc; provider: YProvider }
  | { outcome: 'reset'; epoch: number }
  | { outcome: 'timeout' }
> {
  const doc = new Y.Doc();
  const provider = new YProvider(PARTYKIT_HOST, roomName, doc, {
    connect: true,
    ...(epoch === null ? {} : { params: { clientResetEpoch: String(epoch) } }),
  });

  const result = await new Promise<
    { outcome: 'synced' } | { outcome: 'reset'; epoch: number } | { outcome: 'timeout' }
  >((resolve) => {
    const timer = setTimeout(() => resolve({ outcome: 'timeout' }), SYNC_TIMEOUT_MS);
    const settle = (value: { outcome: 'synced' } | { outcome: 'reset'; epoch: number }) => {
      clearTimeout(timer);
      resolve(value);
    };

    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) settle({ outcome: 'synced' });
    });

    provider.on('custom-message', (message: unknown) => {
      let parsed: { type?: string; resetEpoch?: unknown };
      try {
        parsed = JSON.parse(String(message)) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.type !== 'room-reset') return;
      const next = Number(parsed.resetEpoch);
      if (Number.isFinite(next)) settle({ outcome: 'reset', epoch: next });
    });
  });

  if (result.outcome === 'synced') return { outcome: 'synced', doc, provider };

  provider.destroy();
  doc.destroy();
  return result;
}

/**
 * Connect to one room and wait for the server's state to arrive.
 *
 * ## The reset-epoch handshake
 *
 * playhtml's server can declare a room "reset" at some epoch, and it refuses
 * any client that does not name that epoch — closing with code 4000 and a
 * `{"type":"room-reset","resetEpoch":N}` message, over and over, so that a
 * naive client reconnects forever and syncs nothing. The browser survives this
 * because it keeps the epoch in `localStorage` and sends it back as a query
 * parameter, so after one round trip it is admitted.
 *
 * There is no `localStorage` out here and nothing to remember between runs, so
 * the round trip happens every time: connect bare, be told the epoch, reconnect
 * naming it. The loop is for the case the browser also loops over — a room
 * reset *again* while we were reconnecting, which answers with a higher epoch
 * rather than with the document.
 */
async function connect(host: string, room: string, label: string): Promise<Connection> {
  const roomName = roomNameFor(host, room);
  let epoch: number | null = null;

  for (let tries = 0; tries < MAX_RESET_ROUNDS; tries += 1) {
    const result = await attempt(roomName, epoch);

    if (result.outcome === 'synced') {
      return { doc: result.doc, provider: result.provider, roomName, label };
    }
    if (result.outcome === 'timeout') {
      throw new Error(`${label}: no sync from ${roomName} within ${SYNC_TIMEOUT_MS}ms`);
    }

    // A repeat of an epoch we already sent is the server refusing us for some
    // other reason; retrying would spin.
    if (epoch !== null && result.epoch <= epoch) {
      throw new Error(
        `${label}: ${roomName} keeps resetting at epoch ${result.epoch} even when asked for it`,
      );
    }
    console.log(
      `  ${label}: room was reset at ${new Date(result.epoch).toISOString()}, reconnecting`,
    );
    epoch = result.epoch;
  }

  throw new Error(`${label}: ${roomName} reset ${MAX_RESET_ROUNDS} times without settling`);
}

/** The map of `usePageData` channels, or `null` if the document has none yet. */
function pageDataMap(doc: Y.Doc): Y.Map<unknown> | null {
  const page = doc.getMap(STORE_MAP).get(PAGE_DATA_KEY);
  return page instanceof Y.Map ? (page as Y.Map<unknown>) : null;
}

/**
 * A one-line-per-channel summary. Sizes come from the Y types directly rather
 * than from `toJSON()`: `pages` is hundreds of pages of 960 cells each, and
 * materialising that as plain objects to count its keys would be minutes of
 * work for a number already on the map.
 */
function inventory(doc: Y.Doc): Map<string, number> {
  const counts = new Map<string, number>();
  const channels = pageDataMap(doc);
  if (channels == null) return counts;
  for (const [name, value] of channels.entries()) {
    if (value instanceof Y.Map) counts.set(name, value.size);
    else if (value instanceof Y.Array) counts.set(name, value.length);
    else counts.set(name, 1);
  }
  return counts;
}

function reportInventory(label: string, counts: Map<string, number>): void {
  if (counts.size === 0) {
    console.log(`  ${label}: empty — no channels in this document`);
    return;
  }
  console.log(`  ${label}:`);
  for (const name of [...counts.keys()].sort()) {
    console.log(`    ${name.padEnd(22)} ${counts.get(name)} entries`);
  }
}

/** Which channels this run should move. */
function channelsToCopy(options: Options, source: Y.Doc): string[] {
  const present = new Set(inventory(source).keys());

  // `--with-chat` is narrower than `--all-channels` on purpose. What people
  // mean by "bring the conversations" is the transcript, not `vote:*` (a
  // half-finished ballot from a session that ended) or `room-sync:*` (which
  // page a room happened to be showing). Those two are the state of a sitting,
  // and a sitting does not move house.
  const requested =
    options.only ??
    (options.allChannels
      ? [...present]
      : [
          ...CONTENT_CHANNELS,
          ...(options.withChat ? [...present].filter((name) => CHAT_CHANNEL.test(name)) : []),
        ]);

  const selected = requested.filter((name) => {
    if (NEVER_COPY.test(name)) {
      console.log(`  skipping ${name} — presence is about who is here now, not about pages`);
      return false;
    }
    if (!present.has(name)) {
      console.log(`  skipping ${name} — not present in the source document`);
      return false;
    }
    return true;
  });

  return selected;
}

/**
 * Write both documents to disk as Yjs updates, before anything is changed.
 *
 * The whole document is saved, not the selected channels: a backup narrower
 * than the thing it protects is not a backup. Restoring one is a three-line
 * script against the same room.
 */
async function backup(dir: string, connections: Connection[]): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const written: string[] = [];

  for (const { doc, roomName, label } of connections) {
    const file = path.join(dir, `${stamp}--${label}--${roomName}.yupdate`);
    await writeFile(file, Y.encodeStateAsUpdate(doc));
    written.push(file);
  }

  return written;
}

/**
 * Copy one channel across, replacing rather than merging.
 *
 * `clone()` is what makes this safe. The alternative — reading a channel as
 * JSON and writing plain objects back — would silently change the shape of the
 * document, because playhtml's synced store expects Y types underneath and
 * turns arrays and maps into `Y.Array` and `Y.Map`. `clone()` reproduces the
 * structure exactly, and a structure the library did not build is precisely the
 * kind of thing that reads fine and breaks on the next write.
 *
 * ## One channel per transaction, and not one transaction for all of them
 *
 * A channel is written atomically, so a watching browser never renders half a
 * page — but the channels go one at a time, with a flush between, rather than
 * as a single update for the batch.
 *
 * This is not a preference. Done as one transaction, `pages` (ninety-odd pages
 * of 960 cells) produces a message large enough that closing the socket
 * afterwards truncates it: the first channels arrive, the rest are still in the
 * send buffer and are lost, and the write reports success having moved about
 * half of what it claimed. Bounding each message to one channel, and waiting
 * for the buffer to drain before queueing the next, is what makes the copy
 * actually land.
 */
function copyChannel(source: Y.Doc, destination: Y.Doc, name: string): void {
  const from = pageDataMap(source);
  if (from == null) throw new Error('The source document has no channels to copy');

  destination.transact(() => {
    const store = destination.getMap(STORE_MAP);
    let to = store.get(PAGE_DATA_KEY);
    if (!(to instanceof Y.Map)) {
      to = new Y.Map();
      store.set(PAGE_DATA_KEY, to);
    }

    const value = from.get(name);
    (to as Y.Map<unknown>).set(
      name,
      value instanceof Y.Map || value instanceof Y.Array ? value.clone() : value,
    );
  });
}

/**
 * Wait until the provider's socket has actually put everything on the wire.
 *
 * `bufferedAmount` is the only honest signal available: the sync protocol has
 * no application-level ack, so "we called `set`" and "the server has it" are
 * separated by a queue nothing else reports on.
 */
async function flushed(provider: YProvider): Promise<void> {
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  for (;;) {
    const buffered = provider.ws?.bufferedAmount ?? 0;
    if (buffered === 0) {
      // Drained, but the server still has to receive and persist it. Yielding
      // for a beat here costs a second per channel and removes the race.
      await new Promise((resolve) => setTimeout(resolve, FLUSH_SETTLE_MS));
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Socket still holds ${buffered} bytes after ${FLUSH_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * A channel's content, reduced to something two documents can be compared on.
 *
 * `null` when the channel is absent, which is distinct from a channel that is
 * present and empty — the first is a write that never landed, the second can
 * be a legitimately empty map.
 */
function digest(doc: Y.Doc, name: string): string | null {
  const channels = pageDataMap(doc);
  const value = channels?.get(name);
  if (value === undefined) return null;
  const plain = value instanceof Y.Map || value instanceof Y.Array ? value.toJSON() : value;
  return createHash('sha256').update(JSON.stringify(plain)).digest('hex');
}

/**
 * Re-read the destination on a *fresh* connection and prove it matches.
 *
 * Two things make this the real check rather than a formality.
 *
 * **It is a new connection.** Checking the document we just wrote to would only
 * prove that the local copy changed. The question worth answering is whether
 * the server kept it, and the only way to ask is to connect again as a new
 * client would.
 *
 * **It compares content, not counts.** An earlier version of this script
 * compared entry counts, and counts are exactly what a truncated write gets
 * right: the channels that arrived were whole, so the tally for each of them
 * matched, and the ones still sitting in a closed socket's buffer were simply
 * absent. Hashing the channel catches a short page as readily as a missing one.
 */
async function verify(
  host: string,
  room: string,
  expected: readonly string[],
  source: Y.Doc,
): Promise<Map<string, number>> {
  const want = new Map(expected.map((name) => [name, digest(source, name)]));
  let wrong: string[] = [];

  for (let round = 1; round <= VERIFY_ROUNDS; round += 1) {
    const check = await connect(host, room, 'verify');
    const counts = inventory(check.doc);
    wrong = expected.filter((name) => digest(check.doc, name) !== want.get(name));
    check.provider.destroy();
    check.doc.destroy();

    if (wrong.length === 0) return counts;

    if (round < VERIFY_ROUNDS) {
      console.log(`  ${wrong.length} channels do not match yet, looking again…`);
      await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_MS));
    }
  }

  throw new Error(
    `Destination does not match the source on: ${wrong.join(', ')}. ` +
      'Nothing was removed — re-run to try again, or restore from room-backups/.',
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (options.from === options.to) {
    throw new Error('--from and --to are the same host; there is nothing to move');
  }

  console.log(`room name: ${options.room}`);
  console.log(`  source      ${options.from} → ${roomNameFor(options.from, options.room)}`);
  console.log(`  destination ${options.to} → ${roomNameFor(options.to, options.room)}\n`);

  const source = await connect(options.from, options.room, 'source');
  const destination = await connect(options.to, options.room, 'destination');

  try {
    console.log('documents as they stand:');
    reportInventory(`source      (${options.from})`, inventory(source.doc));
    reportInventory(`destination (${options.to})`, inventory(destination.doc));

    const files = await backup(options.backupDir, [source, destination]);
    console.log('\nbacked up before any change:');
    for (const file of files) console.log(`  ${file}`);

    console.log('\nchannels to move:');
    const channels = channelsToCopy(options, source.doc);
    if (channels.length === 0) {
      console.log('  nothing selected — stopping');
      return;
    }
    const sourceCounts = inventory(source.doc);
    for (const name of channels) {
      console.log(`  ${name.padEnd(22)} ${sourceCounts.get(name)} entries`);
    }

    if (!options.apply) {
      console.log('\nDry run. Nothing was written. Re-run with --apply to move them.');
      return;
    }

    console.log('\nmoving:');
    for (const name of channels) {
      copyChannel(source.doc, destination.doc, name);
      await flushed(destination.provider);
      console.log(`  sent ${name.padEnd(22)} ${sourceCounts.get(name)} entries`);
    }

    // Verified while the destination is still connected, so that anything the
    // server has not finished persisting can still arrive between rounds.
    const counts = await verify(options.to, options.room, channels, source.doc);
    console.log('\ndestination, read back on a new connection:');
    reportInventory(options.to, counts);
    console.log(`\nDone. ${options.to} now serves the pages that were on ${options.from}.`);
  } finally {
    try {
      source.provider.destroy();
      source.doc.destroy();
    } catch {
      // Already torn down, or never fully connected; nothing to salvage.
    }
    try {
      destination.provider.destroy();
      destination.doc.destroy();
    } catch {
      // Already torn down, or never fully connected; nothing to salvage.
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
