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

import { useEffect, useState } from 'react';
import { usePlayContext } from '@playhtml/react';

/**
 * How long syncing may take before a screen stops promising it is a moment.
 *
 * A cold load of the shared document takes about ten seconds at its current
 * size; a room playhtml's server cannot open takes forever, with the provider
 * reconnecting every few seconds and never syncing (October 2026: the document
 * grew to ~8 MB and the room crashed on every connect). Ten seconds is past the
 * first by enough and early enough in the second that nobody has given up yet.
 */
export const STALL_MS = 10_000;

export type ConnectionStatus = 'connected' | 'disconnected';

export interface ConnectionApi {
  /**
   * Current connection status to the Playhtml_Store, derived from the
   * playhtml context signals (see module docs). `'connected'` only once the
   * room document has synced; `'disconnected'` while connecting, syncing, or
   * when no provider is mounted.
   */
  status: ConnectionStatus;
  /**
   * Still not synced after {@link STALL_MS}. A screen waiting on the document
   * says it cannot be reached instead of showing a wait that will not end.
   */
  unreachable: boolean;
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

  const syncing = isProviderMissing || isLoading;
  const status: ConnectionStatus = syncing ? 'disconnected' : 'connected';

  // Only ever set to true, and only read through `syncing`, so the flag cannot
  // outlive the wait it describes.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => setTimedOut(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [syncing]);

  return { status, unreachable: syncing && timedOut };
}
