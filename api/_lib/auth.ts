/**
 * Admin identity, decided on the server.
 *
 * This replaces `src/collab/moderator.ts`, which could not do the job: it
 * compared a passcode against `import.meta.env.VITE_MODERATOR_PASSCODE`, and
 * anything prefixed `VITE_` is inlined into the client bundle at build time.
 * The passcode was readable by every visitor, and the resulting "is moderator"
 * flag lived in `localStorage`, where anyone could simply set it. Its own file
 * comment said as much.
 *
 * What is here instead:
 *
 * - The password never leaves the server. `ADMIN_PASSWORD` is deliberately
 *   *not* `VITE_`-prefixed, so Vite cannot inline it even by accident.
 * - A signed, expiring token in an `HttpOnly` cookie stands in for the session,
 *   so JavaScript on the page cannot read or forge it.
 * - Both comparisons are timing-safe.
 *
 * One admin, one password. A user table and per-person logins would be more
 * moving parts than the thing being protected — there is one operator, and what
 * is at stake is accidental edits to a curated archive.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

/** Cookie holding the signed session token. */
export const SESSION_COOKIE = 'teletext_admin';

/** How long a sign-in lasts. Long enough not to be a nuisance for one operator. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Compare two strings without leaking how much of a prefix matched.
 *
 * `timingSafeEqual` throws on length mismatch — which would itself leak the
 * length — so both sides are hashed to a fixed width first.
 */
function equals(a: string, b: string): boolean {
  const secret = process.env.SESSION_SECRET ?? '';
  const digest = (value: string): Buffer =>
    createHmac('sha256', secret).update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** The signature for a token expiring at `expiry`. */
function sign(expiry: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');
  return createHmac('sha256', secret).update(`admin:${expiry}`).digest('hex');
}

/** Mint a token for a session starting now. */
export function issueToken(): string {
  const expiry = Date.now() + SESSION_MS;
  return `${expiry}.${sign(expiry)}`;
}

/** Whether `token` is one we issued and has not expired. */
export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const expiry = Number(token.slice(0, separator));
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  try {
    return equals(token.slice(separator + 1), sign(expiry));
  } catch {
    // No SESSION_SECRET configured: fail closed rather than admitting anyone.
    return false;
  }
}

/**
 * Check a submitted password against `ADMIN_PASSWORD`.
 *
 * Fails closed when no password is configured, so a deployment that forgot to
 * set one is locked rather than wide open — the mistake the old client-side
 * check made in reverse.
 */
export function passwordMatches(submitted: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof submitted !== 'string' || submitted.length === 0) {
    return false;
  }
  return equals(submitted, expected);
}

/** Read one cookie out of a request's `Cookie` header. */
export function readCookie(req: VercelRequest, name: string): string | undefined {
  // Vercel parses cookies for us, but the header is the fallback when it does
  // not (e.g. a cron invocation).
  const parsed = req.cookies?.[name];
  if (typeof parsed === 'string') return parsed;

  const header = req.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Whether this request carries a valid admin session. */
export function isAdmin(req: VercelRequest): boolean {
  return verifyToken(readCookie(req, SESSION_COOKIE));
}

/**
 * Whether this request is Vercel's scheduled invocation.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set.
 * With no `CRON_SECRET` configured this returns false, so the schedule simply
 * does not get in rather than the check passing vacuously.
 */
export function isVercelCron(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return equals(header.slice('Bearer '.length), secret);
}

/** `Set-Cookie` value that establishes the session. */
export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ].join('; ');
}

/** `Set-Cookie` value that clears the session. */
export function clearedCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ');
}

/** Whether a password and session secret are configured at all. */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}
