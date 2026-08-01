/**
 * Fill in `archive_captures.thumbnail` for rows imported before it existed.
 *
 *     bun run db:backfill-thumbnails
 *
 * Works from the stored cells, so it needs neither the corpus images nor a
 * decode — re-running `db:import-corpus` would do the same job but spends ten
 * minutes decoding 3,148 GIFs and PNGs to arrive at pages already in the
 * database.
 *
 * Rows are read and written in batches because the cells are ~59 KB each and
 * the whole corpus is 188 MB; pulling it in one query would be a large amount
 * of memory for a job that only needs 960 bytes out of each page.
 */

import { encodeThumbnail } from '../src/domain/thumbnail';
import { withPool } from './lib/pool';

const BATCH = 200;

async function main(): Promise<void> {
  await withPool(async (pool) => {
    const { rows: pending } = await pool.query<{ count: number }>(
      `select count(*)::int as count from archive_captures
       where thumbnail is null and cells is not null`,
    );
    const total = pending[0]?.count ?? 0;

    if (total === 0) {
      console.log('Every decoded capture already has a thumbnail.');
      return;
    }
    console.log(`${total} captures need a thumbnail.`);

    let done = 0;
    for (;;) {
      const { rows } = await pool.query<{ id: string; cells: unknown }>(
        `select id, cells from archive_captures
         where thumbnail is null and cells is not null
         order by id
         limit $1`,
        [BATCH],
      );
      if (rows.length === 0) break;

      const ids = rows.map((row) => Number(row.id));
      const thumbs = rows.map((row) => encodeThumbnail(row.cells));

      await pool.query(
        `update archive_captures as c
         set thumbnail = t.thumbnail
         from unnest($1::bigint[], $2::text[]) as t(id, thumbnail)
         where c.id = t.id`,
        [ids, thumbs],
      );

      done += rows.length;
      process.stdout.write(`\r  ${done}/${total}`);
    }

    process.stdout.write('\n');
    console.log('Done.');
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
