/**
 * Apply pending SQL migrations from `db/migrations`, in filename order.
 *
 * Each file is applied inside a transaction and recorded in `schema_migrations`,
 * so a re-run is a no-op and a failure part-way through a file leaves nothing
 * behind. Files are never edited once applied — a change is a new file.
 *
 *     bun run db:migrate
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withPool } from './lib/pool';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'db', 'migrations');

async function main(): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  await withPool(async (pool) => {
    await pool.query(`
      create table if not exists schema_migrations (
        name       text        primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await pool.query<{ name: string }>(
      'select name from schema_migrations',
    );
    const applied = new Set(rows.map((row) => row.name));

    let count = 0;
    for (const name of files) {
      if (applied.has(name)) {
        console.log(`  skip  ${name} (already applied)`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
        console.log(`  apply ${name}`);
        count += 1;
      } catch (error) {
        await client.query('rollback');
        throw new Error(
          `Migration ${name} failed and was rolled back: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        client.release();
      }
    }

    console.log(
      count === 0 ? 'Schema already up to date.' : `Applied ${count} migration(s).`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
