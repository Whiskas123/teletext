/**
 * A long-lived Postgres connection for the local scripts.
 *
 * The API routes talk to Neon over HTTP (`api/_lib/db.ts`): one round trip per
 * statement, nothing to keep alive, which is what a function that serves one
 * request wants. The scripts want the opposite — the corpus import runs
 * thousands of statements back to back, and paying an HTTP round trip for each
 * would dominate the runtime — so they hold a real pooled connection instead.
 *
 * Multi-statement SQL (the migration files) also needs this: the HTTP driver
 * takes one statement per request.
 */

import { Pool, neonConfig, type NeonConfig } from '@neondatabase/serverless';

/**
 * Neon's pool speaks WebSocket. Node 22+ and Bun both expose a global
 * `WebSocket`, so no `ws` dependency is needed — but say so plainly if the
 * runtime turns out not to have one, rather than failing inside the driver.
 */
function configureWebSocket(): void {
  if (neonConfig.webSocketConstructor != null) return;
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof ctor !== 'function') {
    throw new Error(
      'No global WebSocket. Run these scripts on Node 22+ or Bun, or add the ' +
        '`ws` package and set neonConfig.webSocketConstructor.',
    );
  }
  neonConfig.webSocketConstructor = ctor as NeonConfig['webSocketConstructor'];
}

/** Open a pool against `DATABASE_URL`. Callers are responsible for `end()`. */
export function openPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `vercel env pull .env.local` after ' +
        'installing the Neon integration, or export it for this shell.',
    );
  }
  configureWebSocket();
  return new Pool({ connectionString: url });
}

/** Run `body` with a pool, closing it even when `body` throws. */
export async function withPool<T>(body: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = openPool();
  try {
    return await body(pool);
  } finally {
    await pool.end();
  }
}
