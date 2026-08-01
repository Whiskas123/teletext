/**
 * `POST /api/auth/login` — exchange the admin password for a session cookie.
 *
 * The password is checked here, on the server, against a variable that never
 * reaches the browser. See `api/_lib/auth.ts` for why that is the point.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  isAuthConfigured,
  issueToken,
  passwordMatches,
  sessionCookie,
} from '../_lib/auth';
import { bodyObject, fail, json, methodIs, serverError } from '../_lib/http';

export default function handler(req: VercelRequest, res: VercelResponse): void {
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

    if (!passwordMatches(bodyObject(req).password)) {
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
