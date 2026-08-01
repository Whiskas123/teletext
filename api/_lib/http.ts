/**
 * Small helpers shared by the API routes: consistent JSON shapes, method
 * guarding, and body parsing that does not trust what it is given.
 *
 * Deliberately thin — there is no framework here, and the routes are easier to
 * read when the plumbing is a handful of named functions rather than a layer.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Send a JSON body with `status`. */
export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

/** Send `{ error }` with `status`. The only error shape the client parses. */
export function fail(res: VercelResponse, status: number, error: string): void {
  json(res, status, { error });
}

/**
 * Guard the HTTP method, answering `405` (and `OPTIONS`) when it does not
 * match. Returns whether the caller should continue.
 */
export function methodIs(
  req: VercelRequest,
  res: VercelResponse,
  ...allowed: string[]
): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (allowed.includes(method)) return true;

  res.setHeader('Allow', allowed.join(', '));
  if (method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  fail(res, 405, `Method ${method} not allowed here.`);
  return false;
}

/**
 * The request body as a plain object.
 *
 * Vercel parses JSON bodies already, but a body can arrive as a string, as
 * `undefined`, or as something that is not an object at all, and every caller
 * would otherwise repeat the same three checks.
 */
export function bodyObject(req: VercelRequest): Record<string, unknown> {
  const raw: unknown = req.body;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isPlainObject(raw) ? raw : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First value of a query parameter, which Vercel may hand over as an array. */
export function queryValue(
  req: VercelRequest,
  name: string,
): string | undefined {
  const value = req.query[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * A query parameter parsed as an integer within `min..max`, or `fallback` when
 * absent, unparseable, or out of range.
 */
export function queryInt(
  req: VercelRequest,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = queryValue(req, name);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Turn a thrown value into a 500, logging the detail server-side but sending
 * back only a generic message: an error off the database driver can name
 * tables, columns, and occasionally the connection string.
 */
export function serverError(
  res: VercelResponse,
  context: string,
  error: unknown,
): void {
  console.error(`[${context}]`, error);
  fail(res, 500, 'Something went wrong on the server.');
}
