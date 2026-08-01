/**
 * Preserve the hand-authored seed pages into `live_pages`, once.
 *
 *     bun run db:import-seed
 *
 * `src/collab/seedData.ts` holds pages written by hand rather than decoded from
 * the archive, and until now the only copy that survived a deploy was the one
 * compiled into the bundle. `src/collab/seedPages.ts` then wrote them into
 * playhtml on every load, overwriting whatever was there whenever `SEED_VERSION`
 * changed — which is what made a redeploy able to discard collaborative edits.
 *
 * This moves them into the database first, so removing that mechanism does not
 * take the content with it.
 *
 * Existing rows are left alone. If the live document has been snapshotted
 * already, its version of a page is more current than the compiled seed and
 * should win.
 */

import { SEED_PAGES, SEED_TITLES } from '../src/collab/seedData';
import { pageToArray } from '../src/domain/pageEncoding';
import { withPool } from './lib/pool';

async function main(): Promise<void> {
  const pageNumbers = Object.keys(SEED_PAGES).map(Number).sort((a, b) => a - b);

  if (pageNumbers.length === 0) {
    console.log('No seed pages to preserve.');
    return;
  }

  await withPool(async (pool) => {
    const numbers: number[] = [];
    const cells: string[] = [];
    const titles: string[] = [];

    for (const pageNumber of pageNumbers) {
      numbers.push(pageNumber);
      cells.push(JSON.stringify(pageToArray(SEED_PAGES[pageNumber])));
      titles.push(SEED_TITLES[pageNumber] ?? '');
    }

    const { rowCount } = await pool.query(
      `insert into live_pages (page_number, cells, title)
       select * from unnest($1::int[], $2::jsonb[], $3::text[])
       on conflict (page_number) do nothing`,
      [numbers, cells, titles],
    );

    console.log(
      `${rowCount ?? 0} of ${pageNumbers.length} seed pages stored ` +
        `(${pageNumbers.length - (rowCount ?? 0)} already had a newer version).`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
