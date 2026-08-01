/**
 * useSnapshot — copy the live playhtml document into the database.
 *
 * playhtml's document lives on PartyKit, a third-party service with no export.
 * If it were lost, so would be every page anyone has edited. This hook is the
 * backup: it reads the `pages` and `titles` channels and posts them to
 * `/api/snapshot`, which stores them in `live_pages`.
 *
 * ## Why the browser does this and not the server
 *
 * The document is only readable by a connected client. A serverless function
 * has no Yjs connection and cannot go and fetch it, so the snapshot has to
 * originate from a browser that is already synced. The scheduled cron therefore
 * only reports on the backup's freshness; an admin with this page open is what
 * actually refreshes it.
 *
 * ## Waiting for sync
 *
 * A just-mounted client has empty channels until the first sync arrives.
 * Snapshotting then would post nothing, which the endpoint declines to treat as
 * "delete everything" — but it would still be a wasted round trip reporting
 * success, so this hook refuses to send an empty document at all.
 */

import { useCallback, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import type { PagesData, TitlesData } from './types';

export interface SnapshotOutcome {
  /** Pages written to the database. */
  stored: number;
  /** Pages the endpoint declined (malformed, or out of range). */
  rejected: number;
}

export interface SnapshotApi {
  /**
   * Send the current document. Resolves with what was stored, or `null` when
   * there was nothing to send or the request failed — `error` says which.
   */
  snapshot(): Promise<SnapshotOutcome | null>;
  /** True while a request is in flight. */
  saving: boolean;
  /** Message from the last failed attempt, else `null`. */
  error: string | null;
  /** Result of the last successful attempt, else `null`. */
  lastResult: SnapshotOutcome | null;
  /** How many pages this client currently has synced. */
  pageCount: number;
}

export function useSnapshot(): SnapshotApi {
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [titles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SnapshotOutcome | null>(null);

  const pageCount = pages == null ? 0 : Object.keys(pages).length;

  const snapshot = useCallback(async (): Promise<SnapshotOutcome | null> => {
    if (pageCount === 0) {
      setError('Nothing synced yet — wait for the pages to load, then retry.');
      return null;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/snapshot', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pages: pages ?? {}, titles: titles ?? {} }),
      });

      if (response.status === 401) {
        setError('Sign in as moderator to back up.');
        return null;
      }
      if (!response.ok) {
        setError(`Backup failed (${response.status}).`);
        return null;
      }

      const body = (await response.json()) as Partial<SnapshotOutcome>;
      const outcome: SnapshotOutcome = {
        stored: typeof body.stored === 'number' ? body.stored : 0,
        rejected: typeof body.rejected === 'number' ? body.rejected : 0,
      };
      setLastResult(outcome);
      return outcome;
    } catch {
      setError('Could not reach the server.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [pages, titles, pageCount]);

  return { snapshot, saving, error, lastResult, pageCount };
}
