/**
 * `bun run room:salvage` — read the old playhtml room and save it to disk.
 * Writes nothing to playhtml, ever.
 *
 *   bun run room:salvage                          # teletext-house on the live site
 *   bun run room:salvage -- --room teletext-house --timeout 900
 *
 * ## Why this exists
 *
 * Until October 2026 everything lived in one room, `teletext-house`. It grew
 * to ~8 MB and playhtml's server ran out of memory on every connect, so the
 * site moved to `teletext-house-2` with the curated archive in the database.
 * The archive and the playground were already backed up in `live_pages`; the
 * guestbook and the rooms' chat were not, and the old room is their only copy.
 *
 * It crashed under every visitor's browser reconnecting every few seconds.
 * With them gone to the new room, a single patient reader has a better chance:
 * this keeps the provider reconnecting for `--timeout` seconds (ten minutes by
 * default) and takes the document the first time it arrives.
 *
 * ## What it writes
 *
 * Into `room-backups/` (git-ignored), named by time and room:
 *
 * - `…--salvage--<room>.yupdate` — the whole document as a Yjs update, history
 *   included. `Y.applyUpdate(doc, readFileSync(file))` gets it all back.
 * - `…--salvage--<room>.guestbook.json` — the guestbook channel as plain JSON,
 *   ready to import wherever the guestbook ends up.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';

import { LiveDocumentError, receiveLiveDocument, roomName } from '../api/_lib/liveDocument';
import { SITE_URL } from '../src/domain/seo';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const siteHost = option('--host') ?? new URL(SITE_URL).hostname;
const room = option('--room') ?? 'teletext-house';
const timeoutMs = Number(option('--timeout') ?? 600) * 1000;
const dir = option('--backup-dir') ?? 'room-backups';

console.log(`Reading ${decodeURIComponent(roomName(siteHost, room))} for up to ${timeoutMs / 1000} s …`);

try {
  const { doc, ms } = await receiveLiveDocument({ siteHost, room, timeoutMs });
  const update = Y.encodeStateAsUpdate(doc);
  const page = doc.getMap('play').get('__page__');
  const channels = page instanceof Y.Map ? (page.toJSON() as Record<string, unknown>) : {};
  const guestbook = channels.guestbook as { entries?: unknown[] } | undefined;

  mkdirSync(dir, { recursive: true });
  const stem = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}--salvage--${room}`);
  writeFileSync(`${stem}.yupdate`, update);
  writeFileSync(`${stem}.guestbook.json`, JSON.stringify(guestbook ?? null, null, 1));

  console.log(`  received in ${ms} ms · ${(update.length / 1024 / 1024).toFixed(1)} MB with history`);
  console.log(`  ${Object.keys(channels).length} channels · ${guestbook?.entries?.length ?? 0} guestbook entries`);
  console.log(`  saved ${stem}.yupdate`);
  console.log(`  saved ${stem}.guestbook.json`);
  process.exit(0);
} catch (error) {
  const reason = error instanceof LiveDocumentError ? `${error.reason}: ${error.message}` : String(error);
  console.error(`Could not read the room — ${reason}`);
  console.error('Nothing was written. Try again later, once no browser is still connecting to it.');
  process.exit(1);
}
