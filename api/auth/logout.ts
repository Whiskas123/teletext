/**
 * `POST /api/auth/logout` — clear the session cookie.
 *
 * Unauthenticated on purpose: signing out is not a privileged act, and refusing
 * it to someone whose session already expired would only strand a stale cookie
 * in their browser.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { clearedCookie } from '../_lib/auth';
import { json, methodIs } from '../_lib/http';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (!methodIs(req, res, 'POST')) return;
  res.setHeader('Set-Cookie', clearedCookie());
  json(res, 200, { admin: false });
}
