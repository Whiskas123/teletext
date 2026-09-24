/**
 * `bun run backup:read` — read the live document the way the daily job does,
 * and say what it found. Writes nothing, anywhere.
 *
 * The daily job depends on playhtml internals that can change without notice
 * (see `api/_lib/liveDocument.ts`). This is the way to check it by hand: it
 * connects, receives the document, prints what the page channels hold, and —
 * when `DATABASE_URL` is set — how many screens the database's copy lacks or
 * has out of date, using only reads.
 *
 *   bun run backup:read                 # the live site
 *   bun run backup:read -- other.host   # another address's document
 *   DATABASE_URL= bun run backup:read   # without comparing (Bun loads .env.local itself)
 */

import { isConfigured, db } from '../api/_lib/db';
import { LiveDocumentError, readLiveDocument, roomName } from '../api/_lib/liveDocument';
import { claimedPages, liveScreens, planMirror } from '../src/domain/liveMirror';
import { SITE_URL } from '../src/domain/seo';

const siteHost = process.argv[2] ?? new URL(SITE_URL).hostname;

try {
  console.log(`Reading ${decodeURIComponent(roomName(siteHost))} …`);
  const { channels, bytes, ms } = await readLiveDocument({ siteHost });
  const claimed = claimedPages(channels);
  const screens = liveScreens(channels);
  const curated = claimed.filter((page) => page < 700).length;

  console.log(`  received in ${ms} ms · ${(bytes / 1024 / 1024).toFixed(1)} MB with history`);
  console.log(`  ${claimed.length} pages on air (${curated} curated, ${claimed.length - curated} playground), ${screens.size} screens`);
  console.log(`  ${Object.values(channels.sources ?? {}).filter((s) => s && Object.keys(s as object).length > 0).length} screens record where they came from`);

  if (isConfigured()) {
    const rows = await db()`select page_number, subpage, digest from live_pages`.catch((error: unknown) => {
      // 42703: undefined column — the database is older than the mirror.
      if ((error as { code?: string }).code === '42703') {
        console.log('  database copy: not compared — run `bun run db:migrate` first (010 adds live_pages.digest)');
        process.exit(0);
      }
      throw error;
    });
    const copy = new Map(rows.map((row) => [`${row.page_number}.${row.subpage}`, (row.digest as string | null) ?? null]));
    const plan = planMirror(screens, copy, { maxRemovals: Infinity });
    console.log(`  database copy: ${copy.size} screens`);
    console.log(`    ${plan.upserts.length} to write (new or changed) — what the daily job would store`);
    console.log(`    ${plan.removed.length} pages gone from the service, ${plan.truncate.length} carousels shorter — left for the moderator mirror`);
  } else {
    console.log('  (no DATABASE_URL: not compared with the database copy)');
  }
} catch (error) {
  if (error instanceof LiveDocumentError) {
    console.error(`Could not read the live document — ${error.reason}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
