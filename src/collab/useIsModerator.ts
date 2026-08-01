/**
 * useIsModerator — reactive read of admin status (`collab/adminSession.ts`).
 *
 * Keeps the boolean shape its call sites already expect, so gating archive
 * edits reads the same as before; what changed is where the answer comes from.
 * It used to be a `localStorage` flag any visitor could set. It is now the
 * server's answer about an `HttpOnly` session cookie.
 *
 * `useSyncExternalStore` is the right primitive here: the status is external,
 * module-level, shared by every screen that asks, and changes outside React.
 */

import { useEffect, useSyncExternalStore } from 'react';

import {
  getAdminStatus,
  refreshAdminStatus,
  subscribeAdminStatus,
  type AdminStatus,
} from './adminSession';

/** The full status, for screens that need to distinguish "not yet known". */
export function useAdminStatus(): AdminStatus {
  const status = useSyncExternalStore(subscribeAdminStatus, getAdminStatus);

  useEffect(() => {
    // Only asks once per page load: concurrent callers share one request and
    // the answer is cached module-wide.
    if (status.loading) void refreshAdminStatus();
  }, [status.loading]);

  return status;
}

/**
 * Whether this browser is recognised as the moderator.
 *
 * `false` while the first check is in flight, so archive pages stay read-only
 * until the server says otherwise rather than the other way round.
 */
export function useIsModerator(): boolean {
  return useAdminStatus().admin;
}
