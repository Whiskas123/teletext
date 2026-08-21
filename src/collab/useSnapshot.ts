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
 * ## Why it is sent in batches
 *
 * A Vercel function refuses a body over 4.5 MB, and a page serialises to about
 * 68 KB — so the whole document stopped fitting at around 66 pages and every
 * backup after that answered `413`. See `domain/snapshotBatch.ts`, and note
 * that the endpoint upserts without ever deleting, which is what makes several
 * partial posts compose into one complete backup.
 *
 * A run that fails part way therefore leaves the pages it managed, which is why
 * the error says how far it got rather than only that it failed.
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

import { batchPages } from '../domain/snapshotBatch';

import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { DESCRIPTIONS_CHANNEL, type DescriptionsData } from './usePageText';
import { SUBPAGE_COUNTS_CHANNEL, type SubpageCounts } from '../domain/subpages';
import type { PageKinds } from '../domain/directory';
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
  /** Which request of how many is in flight, while `saving`. */
  progress: { done: number; total: number } | null;
}

export function useSnapshot(): SnapshotApi {
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [titles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [kinds] = usePageData<PageKinds>(PAGE_KINDS_CHANNEL, {});
  const [descriptions] = usePageData<DescriptionsData>(DESCRIPTIONS_CHANNEL, {});
  // Sent alongside the pages: the cell maps carry a page's screens, but only
  // this says how many of them the carousel actually has, and a restore that
  // guessed from the keys would resurrect subpages that were removed.
  const [subpageCounts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SnapshotOutcome | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const pageCount = pages == null ? 0 : Object.keys(pages).length;

  const snapshot = useCallback(async (): Promise<SnapshotOutcome | null> => {
    if (pageCount === 0) {
      setError('Nothing synced yet — wait for the pages to load, then retry.');
      return null;
    }

    setSaving(true);
    setError(null);

    // The metadata maps are small and are keyed by page number, so each request
    // carries all of them: a batch has to be able to look up the title of any
    // page it contains.
    const meta = {
      titles: titles ?? {},
      kinds: kinds ?? {},
      descriptions: descriptions ?? {},
      subpageCounts: subpageCounts ?? {},
    };

    const batches = batchPages(pages ?? {});
    const outcome: SnapshotOutcome = { stored: 0, rejected: 0 };
    setProgress({ done: 0, total: batches.length });

    try {
      for (const [index, batch] of batches.entries()) {
        const response = await fetch('/api/snapshot', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pages: batch, ...meta }),
        });

        if (response.status === 401) {
          setError('Sign in as moderator to back up.');
          return null;
        }
        if (!response.ok) {
          // Say what did land. The pages already sent are in the backup — the
          // endpoint never deletes — so "failed" on its own would understate it.
          setError(
            batches.length > 1
              ? `Backup failed (${response.status}) after ${outcome.stored} of ` +
                `${pageCount} pages. What was sent is saved; retry to finish.`
              : `Backup failed (${response.status}).`,
          );
          return null;
        }

        const body = (await response.json()) as Partial<SnapshotOutcome>;
        outcome.stored += typeof body.stored === 'number' ? body.stored : 0;
        outcome.rejected += typeof body.rejected === 'number' ? body.rejected : 0;
        setProgress({ done: index + 1, total: batches.length });
      }

      setLastResult(outcome);
      return outcome;
    } catch {
      setError('Could not reach the server.');
      return null;
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }, [pages, titles, kinds, descriptions, subpageCounts, pageCount]);

  return { snapshot, saving, error, lastResult, pageCount, progress };
}
