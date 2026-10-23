/**
 * `/api/auth/<action>` — the admin session. One function for three routes:
 * `vercel.json` rewrites `/api/auth/login|logout|me` to `?action=`, because
 * Vercel's Hobby plan caps a deployment at twelve functions and these three
 * were spending a quarter of them.
 *
 * - `POST login` — exchange the admin password for a session cookie. The
 *   password is checked here, on the server, against a variable that never
 *   reaches the browser. See `api/_lib/auth.ts` for why that is the point.
 * - `POST logout` — clear the cookie. Unauthenticated on purpose: signing out
 *   is not a privileged act, and refusing it to someone whose session already
 *   expired would only strand a stale cookie in their browser.
 * - `GET me` — does this browser hold a valid session? The cookie is
 *   `HttpOnly`, so `useIsModerator` cannot answer that itself. `configured`
 *   lets the sign-in screen tell "wrong password" from "this deployment has no
 *   admin password set", which are very different problems.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  clearedCookie,
  isAdmin,
  isAuthConfigured,
  issueToken,
  passwordMatches,
  sessionCookie,
} from './_lib/auth';
import { db } from './_lib/db';
import { bodyObject, clientKey, fail, json, methodIs, queryValue, serverError } from './_lib/http';

/**
 * Wrong passwords one address may try in {@link LOGIN_WINDOW_MINUTES} before
 * it is refused without a check. Plenty for a person mistyping; a script
 * guessing gets twenty tries a quarter of an hour.
 */
const MAX_FAILED_LOGINS = 20;
const LOGIN_WINDOW_MINUTES = 15;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const action = queryValue(req, 'action');

  if (action === 'me') {
    if (!methodIs(req, res, 'GET')) return;
    // Never cached: a stale "admin: true" at a shared cache would be a security
    // problem, and a stale "false" would log the operator out at random.
    res.setHeader('Cache-Control', 'no-store, private');
    json(res, 200, { admin: isAdmin(req), configured: isAuthConfigured() });
    return;
  }

  if (action === 'logout') {
    if (!methodIs(req, res, 'POST')) return;
    res.setHeader('Set-Cookie', clearedCookie());
    json(res, 200, { admin: false });
    return;
  }

  if (action !== 'login') {
    fail(res, 404, 'No such auth action.');
    return;
  }
  if (!methodIs(req, res, 'POST')) return;

  try {
    if (!isAuthConfigured()) {
      // Say plainly that the deployment is misconfigured rather than reporting
      // a wrong password for a password that could never be right.
      fail(
        res,
        503,
        'Admin access is not configured on this deployment (ADMIN_PASSWORD / SESSION_SECRET).',
      );
      return;
    }

    const who = clientKey(req);
    const [recent] = await db()`
      select count(*)::int as failures from login_failures
      where client = ${who}
        and failed_at > now() - make_interval(mins => ${LOGIN_WINDOW_MINUTES})
    `;
    if ((recent?.failures ?? 0) >= MAX_FAILED_LOGINS) {
      fail(res, 429, 'Too many wrong passwords. Try again in a few minutes.');
      return;
    }

    if (!passwordMatches(bodyObject(req).password)) {
      // Old failures go as new ones arrive, so the table stays the size of
      // one window without a job to sweep it.
      await db()`
        with swept as (
          delete from login_failures
          where failed_at < now() - make_interval(mins => ${LOGIN_WINDOW_MINUTES})
        )
        insert into login_failures (client) values (${who})
      `;
      // No detail, and no distinction between "no password given" and "wrong
      // password" — neither is useful to the person who should be here.
      fail(res, 401, 'Incorrect password.');
      return;
    }

    res.setHeader('Set-Cookie', sessionCookie(issueToken()));
    json(res, 200, { admin: true });
  } catch (error) {
    serverError(res, 'auth/login', error);
  }
}
