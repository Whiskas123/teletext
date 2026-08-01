/**
 * Neon Postgres connection, shared by the API routes and the local scripts.
 *
 * Files under `api/` whose name starts with `_` are not routed by Vercel, so
 * this is a library rather than an endpoint.
 *
 * Two connection styles, because the callers want different things:
 *
 * - {@link sql} is Neon's HTTP driver. One round trip per statement, no
 *   connection to keep alive — the right shape for a serverless function that
 *   handles one request and exits.
 * - {@link transaction} batches statements into a single atomic HTTP request,
 *   for the writes that must not land half-applied (publishing, snapshotting).
 *
 * The corpus import in `scripts/` also uses this, so `DATABASE_URL` is read
 * lazily: importing this module must not throw in a context that only wants the
 * types, and a missing variable should say so in words rather than surfacing as
 * an undefined-connection-string error from inside the driver.
 */

import {
  neon,
  type NeonQueryFunction,
  type NeonQueryFunctionInTransaction,
  type NeonQueryInTransaction,
} from '@neondatabase/serverless';

let cached: NeonQueryFunction<false, false> | null = null;

/** The connection string, or a thrown error naming what to set and where. */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Install the Neon integration on the Vercel ' +
        'project, then run `vercel env pull .env.local` to get it locally.',
    );
  }
  return url;
}

/**
 * Tagged-template query function.
 *
 * ```ts
 * const rows = await sql`select * from archive_captures where source = ${source}`;
 * ```
 *
 * Interpolations are sent as bound parameters, never spliced into the SQL, so
 * values coming off a request cannot alter the statement.
 */
export function db(): NeonQueryFunction<false, false> {
  cached ??= neon(connectionString());
  return cached;
}

/**
 * Run several statements as one atomic unit.
 *
 * `build` returns the queries un-awaited — Neon's HTTP transaction collects the
 * prepared statements and sends them in a single request, so awaiting them
 * first would defeat it and run each on its own:
 *
 * ```ts
 * await transaction((sql) => [
 *   sql`delete from published_pages where page_number = ${n}`,
 *   sql`insert into published_pages ...`,
 * ]);
 * ```
 */
export async function transaction(
  build: (
    sql: NeonQueryFunctionInTransaction<false, false>,
  ) => NeonQueryInTransaction[],
): Promise<unknown[]> {
  return db().transaction(build);
}

/** Whether a `DATABASE_URL` is configured, without throwing when it is not. */
export function isConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
