/**
 * `GET /api/auth/me` — does this browser hold a valid admin session?
 *
 * The client cannot answer this itself: the session cookie is `HttpOnly`, which
 * is exactly what stops page scripts (and anyone in the console) from reading or
 * forging it. So `useIsModerator` asks the server.
 *
 * `configured` lets the sign-in screen distinguish "wrong password" from "this
 * deployment has no admin password set", which are very different problems and
 * used to be indistinguishable.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isAdmin, isAuthConfigured } from '../_lib/auth';
import { json, methodIs } from '../_lib/http';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (!methodIs(req, res, 'GET')) return;

  // Never cached: a stale "admin: true" at a shared cache would be a security
  // problem, and a stale "false" would log the operator out at random.
  res.setHeader('Cache-Control', 'no-store, private');
  json(res, 200, { admin: isAdmin(req), configured: isAuthConfigured() });
}
