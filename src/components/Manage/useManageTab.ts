/**
 * Which tab `/manage` is showing, mirrored into the URL.
 *
 * The tab is React state, and the URL follows it — not the other way round: a
 * browser that refuses the write (a sandboxed frame, an extension, a quota on
 * history entries) must not leave the operator looking at a panel the screen
 * thought was not selected. State is authoritative; the URL is a courtesy.
 *
 * Replace, never push: switching tabs is not navigation, and Back should leave
 * `/manage` rather than walk through every tab looked at on the way.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { resolveTabParam, tabParam, type TabKey } from '../../domain/manageTabs';

export interface ManageTabApi {
  selected: TabKey;
  select(tab: TabKey): void;
  /** Whether the URL asked for the archive pane (an old `?tab=archive` link). */
  initialArchive: boolean;
}

export function useManageTab(): ManageTabApi {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read once, on arrival. Re-reading on later renders would let a failed
  // write drag the panel back out from under the operator.
  const [initial] = useState(() => resolveTabParam(searchParams.getAll('tab')));
  const [selected, setSelected] = useState<TabKey>(initial.tab);

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
        // The tab is selected and rendered; the URL simply does not say so.
      }
    },
    [setSearchParams],
  );

  // A value that was present but not canonical — misspelled, repeated, or an
  // old name — is corrected once. An absent one is left absent.
  useEffect(() => {
    if (initial.present && !initial.canonical) writeParam(initial.tab);
  }, [initial, writeParam]);

  const select = useCallback(
    (tab: TabKey) => {
      if (tab === selected) return;
      setSelected(tab);
      writeParam(tab);
    },
    [selected, writeParam],
  );

  return { selected, select, initialArchive: initial.archive };
}
