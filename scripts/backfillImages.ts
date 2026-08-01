/**
 * Store the render of every capture that does not have one yet.
 *
 *     bun run db:backfill-images
 *
 * Needs the corpus on disk, because the images are the one thing the database
 * does not already hold — but not a decode, so it is minutes rather than the
 * ten `db:import-corpus` spends turning 3,148 renders back into pages that are
 * already stored.
 *
 * Captures are matched the same way the import matches them: by filename, so a
 * capture that was re-filed into a different topic folder is still found.
 */

import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { encodeCaptureImage } from './lib/loadImageNode';
import { withPool } from './lib/pool';

const ROOT = join(import.meta.dirname, '..');

/** How many captures to send per statement. Each is a couple of kilobytes. */
const BATCH = 50;

async function indexCorpus(dir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(gif|png)$/i.test(entry.name)) index.set(entry.name, path);
    }
  };
  await walk(dir);
  return index;
}

async function main(): Promise<void> {
  const onDisk = new Map<string, string>();
  for (const source of ['rtp', 'sic']) {
    const dir = join(ROOT, `archive-corpus-${source}`);
    for (const [name, path] of await indexCorpus(dir)) onDisk.set(name, path);
  }
  console.log(`${onDisk.size} images on disk.`);

  await withPool(async (pool) => {
    const { rows: pending } = await pool.query<{ count: number }>(
      'select count(*)::int as count from archive_captures where image is null',
    );
    const total = pending[0]?.count ?? 0;
    if (total === 0) {
      console.log('Every capture already has an image.');
      return;
    }
    console.log(`${total} captures need one.`);

    let done = 0;
    let missing = 0;

    for (;;) {
      const { rows } = await pool.query<{ id: string; corpus_file: string }>(
        `select id, corpus_file from archive_captures
         where image is null
         order by id
         limit $1 offset $2`,
        [BATCH, missing],
      );
      if (rows.length === 0) break;

      const ids: number[] = [];
      const images: Buffer[] = [];

      for (const row of rows) {
        const path = onDisk.get(basename(row.corpus_file));
        if (path == null) {
          // Counted and stepped over via the offset, so the loop cannot spin
          // forever on a capture whose image is not on this machine.
          missing += 1;
          continue;
        }
        try {
          images.push(await encodeCaptureImage(path));
          ids.push(Number(row.id));
        } catch {
          missing += 1;
        }
      }

      if (ids.length > 0) {
        await pool.query(
          `update archive_captures as c
           set image = t.image, image_type = 'image/webp'
           from unnest($1::bigint[], $2::bytea[]) as t(id, image)
           where c.id = t.id`,
          [ids, images],
        );
        done += ids.length;
        process.stdout.write(`\r  ${done}/${total} stored`);
      }
    }

    process.stdout.write('\n');
    const bytes = await pool.query<{ total: string }>(
      'select coalesce(sum(length(image)), 0)::text as total from archive_captures',
    );
    console.log(
      `Stored ${done} images${missing > 0 ? `, ${missing} not found on disk` : ''}. ` +
        `Total ${(Number(bytes.rows[0]?.total ?? 0) / 1e6).toFixed(1)} MB.`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
