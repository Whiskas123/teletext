/**
 * Read `live_pages` back out of the database, for restoring a lost document.
 *
 *     bun run db:restore                 # summarise what the backup holds
 *     bun run db:restore --out pages.json  # write it in playhtml's own shape
 *     bun run db:restore --at 2026-11-04T10:00Z --out pages.json
 *                                        # the playground as it was then
 *     bun run db:restore --at 2026-11-04T10:00Z --page 712 --out page.json
 *
 * ## --at: before the page was drawn over
 *
 * Every backup overwrites `live_pages`, so a playground page covered in junk is
 * covered in junk there too by the next half-hourly read. The version before it
 * is in `live_pages_history` (migration 017), which keeps each playground row
 * with the interval it was current. `--at` reads every playground screen whose
 * interval contains that time, from the history and the current copy together.
 * Playground only: the archive keeps no history, and is the moderator's own.
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
import { MIN_SUBPAGE, pageKey } from '../src/domain/subpages';
import { withPool } from './lib/pool';

interface LivePageRow {
  page_number: number;
  subpage: number;
  subpage_count: number;
  cells: unknown;
  title: string;
  kind: string;
  description: string;
  updated_at: Date;
}

interface Options {
  out: string | null;
  at: Date | null;
  page: number | null;
}

function optionValue(argv: string[], name: string, example: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value == null || value.startsWith('--')) throw new Error(`${name} needs a value, e.g. ${name} ${example}`);
  return value;
}

function parseOptions(argv: string[]): Options {
  const out = optionValue(argv, '--out', 'restore.json');
  const atText = optionValue(argv, '--at', '2026-11-04T10:00Z');
  const pageText = optionValue(argv, '--page', '712');
  const at = atText == null ? null : new Date(atText);
  if (at != null && Number.isNaN(at.getTime())) throw new Error(`--at ${atText} is not a time`);
  const page = pageText == null ? null : Number(pageText);
  if (page != null && !(Number.isInteger(page) && page >= 700 && page <= 999)) {
    throw new Error('--page takes a playground page, 700-999');
  }
  if (page != null && at == null) throw new Error('--page goes with --at');
  return { out, at, page };
}

const COLUMNS = 'page_number, subpage, subpage_count, cells, title, kind, description, updated_at';

/**
 * The playground as the backup held it at `at`: each screen's current row if
 * it was written by then, or the history row that was current then. A screen
 * deleted before `at`, or first backed up after it, is absent.
 */
const AT_QUERY =
  `select ${COLUMNS} from (` +
  `  select ${COLUMNS}, 'infinity'::timestamptz as until from live_pages` +
  `  union all` +
  `  select ${COLUMNS}, replaced_at as until from live_pages_history` +
  `) v where page_number >= 700 and updated_at <= $1 and until > $1` +
  ` and ($2::int is null or page_number = $2)` +
  ` order by page_number, subpage`;

async function main(): Promise<void> {
  const { out, at, page } = parseOptions(process.argv.slice(2));

  await withPool(async (pool) => {
    const { rows } =
      at == null
        ? await pool.query<LivePageRow>(`select ${COLUMNS} from live_pages order by page_number, subpage`)
        : await pool.query<LivePageRow>(AT_QUERY, [at.toISOString(), page]);
    if (at != null) console.log(`The playground as backed up at ${at.toISOString()}:`);

    if (rows.length === 0) {
      console.log(
        at == null
          ? 'The backup is empty. Open the app as admin and use "Back up now" first.'
          : 'No playground screen was in the backup at that time.',
      );
      return;
    }

    const newest = rows.reduce(
      (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
      rows[0].updated_at,
    );

    // A row is one screen; a page is one or more of them. Both counts are worth
    // reporting — "418 pages" hides that some of them are carousels.
    const pageNumbers = new Set(rows.map((row) => row.page_number));
    const carousels = rows.filter((row) => row.subpage > MIN_SUBPAGE).length;
    console.log(
      `${pageNumbers.size} pages in the backup (${rows.length} screens, ` +
        `${carousels} of them subpages), newest ${newest.toISOString()}`,
    );

    // Split the report by range, because the two halves mean different things:
    // 100..699 can be re-published from the corpus, 700..999 is visitors' own
    // work and exists nowhere else.
    const archive = [...pageNumbers].filter((page) => page < 700).length;
    console.log(`  archive (100-699):    ${archive}`);
    console.log(`  playground (700-999): ${pageNumbers.size - archive}`);

    if (out == null) {
      console.log('\nRe-run with --out <file> to write a restorable file.');
      return;
    }

    const pages: Record<string, unknown> = {};
    const titles: Record<number, string> = {};
    // Only headings are written: 'page' is the default, so storing it would
    // just be noise the import has to skip.
    const kinds: Record<number, string> = {};
    const descriptions: Record<number, string> = {};
    // Restored explicitly rather than inferred from how many screens came back:
    // a page whose last subpage was removed still has a blanked row in the
    // document it was copied from, and guessing would resurrect it.
    const subpageCounts: Record<number, number> = {};
    for (const row of rows) {
      // Screens are keyed exactly as the live document keys them, so restoring
      // stays a paste rather than a conversion.
      pages[String(pageKey(row.page_number, row.subpage))] = pageToCellMap(row.cells);
      // Title, role and description belong to the page: every one of its rows
      // carries the same values, so writing them once per row is idempotent.
      if (row.title.length > 0) titles[row.page_number] = row.title;
      if (row.kind !== 'page') kinds[row.page_number] = row.kind;
      if (row.description.length > 0) descriptions[row.page_number] = row.description;
      if (row.subpage_count > MIN_SUBPAGE) {
        subpageCounts[row.page_number] = row.subpage_count;
      }
    }

    await writeFile(
      out,
      JSON.stringify({ pages, titles, kinds, descriptions, subpageCounts }, null, 2),
      'utf8',
    );
    console.log(`\nWrote ${out} — load it from the app's import screen as admin.`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
