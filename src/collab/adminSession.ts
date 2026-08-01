/**
 * Admin session, as the browser sees it.
 *
 * Replaces `collab/moderator.ts`, which kept a `localStorage` boolean and
 * compared a passcode inlined into the bundle by `VITE_MODERATOR_PASSCODE`.
 * Anyone could read that passcode, and anyone could set the flag by hand. It was
 * a guard against slips, not against people, and said so.
 *
 * The session now lives in an `HttpOnly` cookie the server issues, which this
 * module cannot read by design. So the question "am I an admin?" is answered by
 * asking `/api/auth/me` rather than by looking anything up locally.
 *
 * ## One request, many components
 *
 * Three screens ask about admin status, and mounting them should not mean three
 * round trips. The answer is cached here, module-wide, and components subscribe
 * to changes — the same pattern the old module used with its custom event, for
 * the same reason.
 *
 * ## It starts as "no"
 *
 * Until the first response arrives, `admin` is `false`. Archive pages are
 * briefly shown as read-only to an admin who is in fact signed in, then unlock.
 * That is the right way round: a moment of over-restriction is a flicker,
 * whereas defaulting to `true` would hand out the archive to everyone for as
 * long as the network took.
 */

export interface AdminStatus {
  /** Whether the server recognises this browser's session. */
  admin: boolean;
  /** Whether an answer has been received yet. */
  loading: boolean;
  /** Whether the deployment has admin access configured at all. */
  configured: boolean;
}

const UNKNOWN: AdminStatus = { admin: false, loading: true, configured: true };

let status: AdminStatus = UNKNOWN;
let inFlight: Promise<AdminStatus> | null = null;
const listeners = new Set<() => void>();

function publish(next: AdminStatus): AdminStatus {
  status = next;
  for (const listener of listeners) listener();
  return next;
}

/** The last known status, without triggering a request. */
export function getAdminStatus(): AdminStatus {
  return status;
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function subscribeAdminStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ask the server who we are.
 *
 * Concurrent callers share one request — every screen calls this on mount, and
 * they commonly mount together.
 */
export function refreshAdminStatus(): Promise<AdminStatus> {
  inFlight ??= (async (): Promise<AdminStatus> => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        return publish({ admin: false, loading: false, configured: false });
      }
      const body: unknown = await response.json();
      const parsed = body as { admin?: unknown; configured?: unknown };
      return publish({
        admin: parsed.admin === true,
        loading: false,
        configured: parsed.configured !== false,
      });
    } catch {
      // Offline, or no API deployed. Not an admin, and say the deployment is
      // unconfigured so the sign-in screen can explain itself.
      return publish({ admin: false, loading: false, configured: false });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Result of attempting to sign in. */
export type SignInResult =
  | { ok: true }
  | { ok: false; reason: 'incorrect' | 'unconfigured' | 'network' };

/**
 * Exchange a password for a session cookie.
 *
 * The cookie is set by the server; nothing is stored here. On success the
 * cached status is updated so subscribed screens re-render.
 */
export async function signInAsAdmin(password: string): Promise<SignInResult> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      publish({ admin: true, loading: false, configured: true });
      return { ok: true };
    }
    if (response.status === 503) {
      publish({ admin: false, loading: false, configured: false });
      return { ok: false, reason: 'unconfigured' };
    }
    return { ok: false, reason: 'incorrect' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** Clear the session cookie. */
export async function signOutAsAdmin(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // The cached status is cleared regardless: if the request failed, the
    // cookie may survive, but the next /api/auth/me will settle it.
  }
  publish({ admin: false, loading: false, configured: status.configured });
}
