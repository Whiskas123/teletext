/**
 * The boot pages, kept compressed in Postgres.
 *
 * ## The problem this solves
 *
 * `GET /api/snapshot?boot` is the first thing every page load asks for. Built
 * from `live_pages` it pulled 8.4 MB out of Neon per request — the cells are
 * stored complete, as JSON, and the driver does not compress — to answer with
 * 330 KB. The edge holds the answer for a minute at most, so on a quiet site
 * nearly every visit paid for it: 4 GB of the free plan's 5 GB a month.
 *
 * Here the compressed answer is stored, and a read costs about 450 KB.
 *
 * ## Why the version is worked out on every read
 *
 * It is derived from `live_pages` rather than maintained by whoever writes, so
 * the moderators' saves, the daily cron and the scripts cannot forget to
 * invalidate it, and a read can never be behind the table — which is why
 * `/manage`'s `fresh` reads may come through here too. It hashes every row's
 * `updated_at` rather than taking the newest: a deletion moves no timestamp,
 * and of two overlapping writes the later commit can carry the earlier one.
 * The query never touches `cells`, so it is cheap.
 */

import { gzipSync } from 'node:zlib';

import { db } from './db';

/** The boot pages as a gzip body, rebuilt only if `live_pages` has changed. */
export async function bootBody(build: () => Promise<unknown>): Promise<Buffer> {
  const [row] = await db()`
    with live as (
      select coalesce(md5(string_agg(
        page_number || '.' || subpage || '@' || updated_at, ','
        order by page_number, subpage
      )), '') as version
      from live_pages
    )
    select live.version, cache.body
    from live left join boot_cache cache on cache.version = live.version
  `;
  if (row.body != null) return Buffer.from(String(row.body), 'base64');

  // Compressed here rather than left to the platform: uncompressed, a few
  // hundred pages pass the 4.5 MB a function may return, and they shrink about
  // sixteenfold.
  const body = gzipSync(JSON.stringify(await build()));

  // `version` was read before the pages, so a write landing in between leaves
  // newer pages under an older version: the next read misses and rebuilds.
  const version = String(row.version);
  const encoded = body.toString('base64');
  try {
    await db()`
      insert into boot_cache (id, version, body) values (true, ${version}, ${encoded})
      on conflict (id) do update set version = excluded.version, body = excluded.body
    `;
  } catch (error) {
    // The pages are in hand: a failed save costs the next read a rebuild, and
    // must not cost this one its answer.
    console.error('[bootCache]', error);
  }
  return body;
}
