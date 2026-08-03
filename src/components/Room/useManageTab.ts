/**
 * Which tab `/manage` is showing, mirrored into the URL.
 *
 * The tab is React state, and the URL follows it. Not the other way round: a
 * browser that refuses the write — a sandboxed frame, an extension, a quota on
 * history entries — would otherwise leave the operator looking at a panel the
 * screen thought was not selected. State is authoritative, the URL is a
 * courtesy, and the courtesy is allowed to fail.
 *
 * ## Replace, never push
 *
 * Switching tabs is not navigation. Pushing would mean Back walks through every
 * tab the operator looked at before it leaves `/manage`, which is nobody's idea
 * of Back. One visit to `/manage` is one history entry however many times the
 * tab changes.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { resolveTabParam, tabParam, type TabKey } from '../../domain/manageTabs';

export interface ManageTabApi {
  selected: TabKey;
  select(tab: TabKey): void;
  /**
   * Whether the archive tab has been shown at least once this load. Gates the
   * corpus and saved-menu queries, and never goes back to false — switching
   * away should not throw the results away.
   */
  archiveVisited: boolean;
}

export function useManageTab(): ManageTabApi {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read once, from the URL as it was on arrival. Re-reading it on later renders
  // would let a failed write drag the panel back out from under the operator.
  const [initial] = useState(() => resolveTabParam(searchParams.getAll('tab')));

  const [selected, setSelected] = useState<TabKey>(initial.tab);
  const [archiveVisited, setArchiveVisited] = useState(initial.tab === 'archive');

  /**
   * Write `tab` into the URL, leaving the path and every other parameter alone.
   *
   * Wrapped because this reaches the History API, and a refused write must not
   * take the selection down with it.
   */
  const writeParam = useCallback(
    (tab: TabKey) => {
      try {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set('tab', tabParam(tab));
            return next;
          },
          { replace: true },
        );
      } catch {
        // Nothing to retry: the tab is selected, the panel is rendered, and the
        // URL simply does not say so.
      }
    },
    [setSearchParams],
  );

  // A `tab` value that was present but not canonical — empty, repeated, or
  // misspelled — is corrected once. An absent one is left absent: a bare
  // /manage has nothing wrong with it, and rewriting it would replace a history
  // entry the visitor never asked us to touch.
  useEffect(() => {
    if (initial.present && !initial.canonical) writeParam(initial.tab);
  }, [initial, writeParam]);

  const select = useCallback(
    (tab: TabKey) => {
      // Selecting the tab that is already selected changes nothing, including
      // the number of history entries.
      if (tab === selected) return;
      setSelected(tab);
      if (tab === 'archive') setArchiveVisited(true);
      writeParam(tab);
    },
    [selected, writeParam],
  );

  return { selected, select, archiveVisited };
}
