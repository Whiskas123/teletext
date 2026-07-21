/**
 * useConnection — reports the room's connection status to the Playhtml_Store.
 *
 * Design notes (see design.md "Shared-state hooks: useConnection" and
 * "Connection lost / Reconnect" in Error Handling; Req 8):
 *
 * The installed playhtml / @playhtml/react API (playhtml 2.13.x,
 * @playhtml/react 2.0.x) does NOT expose an explicit connected/disconnected
 * boolean or a Yjs provider `status` event through its public React surface.
 * The only connection-related signals available on `usePlayContext()` are:
 *
 *   - `isProviderMissing: boolean` — true when no `PlayProvider` is mounted
 *     above this hook (the client cannot be synced at all).
 *   - `isLoading: boolean` — true while playhtml is initializing / has not yet
 *     synced the room document; flips to false once the initial sync completes.
 *     (`hasSynced` is the deprecated inverse of this and is intentionally not
 *     used.)
 *
 * We therefore DERIVE the status from these two signals:
 *
 *   status === 'connected'    iff  a provider is present AND !isLoading
 *                                  (the room document has synced)
 *   status === 'disconnected' iff  isProviderMissing OR isLoading
 *                                  (not yet synced / still connecting)
 *
 * Treating `isLoading` as "disconnected" is the conservative choice required by
 * Req 8.1: while the client has not synced we surface the disconnected
 * indicator rather than implying a live connection.
 *
 * Buffering and reconnection (Req 8.4 / 8.5) are handled by playhtml/Yjs
 * itself: edits made while offline are buffered locally and reconciled on
 * reconnect through the same shared-state (cell-map) writes, converging via
 * Yjs last-writer-wins. Retaining the last-known page while disconnected
 * (Req 8.3) is a consumer concern — nothing is cleared here; this hook only
 * reports status.
 */

import { usePlayContext } from '@playhtml/react';

export type ConnectionStatus = 'connected' | 'disconnected';

export interface ConnectionApi {
  /**
   * Current connection status to the Playhtml_Store, derived from the
   * playhtml context signals (see module docs). `'connected'` only once the
   * room document has synced; `'disconnected'` while connecting, syncing, or
   * when no provider is mounted.
   */
  status: ConnectionStatus;
}

/**
 * Report the room's connection status.
 *
 * Derivation:
 * - `isProviderMissing` → no PlayProvider mounted → `'disconnected'`.
 * - `isLoading` → initializing / not yet synced → `'disconnected'`.
 * - otherwise (provider present and synced) → `'connected'`.
 */
export function useConnection(): ConnectionApi {
  const { isLoading, isProviderMissing } = usePlayContext();

  const status: ConnectionStatus =
    isProviderMissing || isLoading ? 'disconnected' : 'connected';

  return { status };
}
