/**
 * Read `live_pages` back out of the database, for restoring a lost document.
 *
 *     bun run db:restore                 # summarise what the backup holds
 *     bun run db:restore --out pages.json  # write it in playhtml's own shape
 *
 * ## Why this does not write to playhtml directly
 *
 * Only a connected browser can write the Yjs document, exactly as only a
 * connected browser can read it (see `src/collab/useSnapshot.ts`). So a restore
 * is: run this to produce a JSON file, then load it in the app's import screen
 * while signed in as admin.
 *
 * The output is already in playhtml's index-keyed shape, so restoring is a
 * paste rather than a conversion.
 *
 * ## Rehearse it
 *
 * An untested backup is not a backup. `--out` writes a file without touching
 * anything, so the whole path can be checked at any time.
 */

import { writeFile } from 'node:fs/promises';

import { pageToCellMap } from '../src/domain/pageEncoding';
import { withPool } from './lib/pool';

interface LivePageRow {
  page_number: number;
  cells: unknown;
  title: string;
  kind: string;
  updated_at: Date;
}

function parseOptions(argv: string[]): { out: string | null } {
  const index = argv.indexOf('--out');
  if (index === -1) return { out: null };
  const path = argv[index + 1];
  if (path == null || path.startsWith('--')) {
    throw new Error('--out needs a file path, e.g. --out restore.json');
  }
  return { out: path };
}

async function main(): Promise<void> {
  const { out } = parseOptions(process.argv.slice(2));

  await withPool(async (pool) => {
    const { rows } = await pool.query<LivePageRow>(
      'select page_number, cells, title, kind, updated_at from live_pages order by page_number',
    );

    if (rows.length === 0) {
      console.log(
        'The backup is empty. Open the app as admin and use "Back up now" first.',
      );
      return;
    }

    const newest = rows.reduce(
      (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
      rows[0].updated_at,
    );

    console.log(`${rows.length} pages in the backup, newest ${newest.toISOString()}`);

    // Split the report by range, because the two halves mean different things:
    // 100..699 can be re-published from the corpus, 700..999 is visitors' own
    // work and exists nowhere else.
    const archive = rows.filter((r) => r.page_number < 700).length;
    const playground = rows.length - archive;
    console.log(`  archive (100-699):    ${archive}`);
    console.log(`  playground (700-999): ${playground}`);

    if (out == null) {
      console.log('\nRe-run with --out <file> to write a restorable file.');
      return;
    }

    const pages: Record<number, unknown> = {};
    const titles: Record<number, string> = {};
    // Only headings are written: 'page' is the default, so storing it would
    // just be noise the import has to skip.
    const kinds: Record<number, string> = {};
    for (const row of rows) {
      pages[row.page_number] = pageToCellMap(row.cells);
      if (row.title.length > 0) titles[row.page_number] = row.title;
      if (row.kind !== 'page') kinds[row.page_number] = row.kind;
    }

    await writeFile(out, JSON.stringify({ pages, titles, kinds }, null, 2), 'utf8');
    console.log(`\nWrote ${out} — load it from the app's import screen as admin.`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
