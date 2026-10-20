/**
 * useSubtitles — the English layer the EN key puts over a page.
 *
 * The words come from `/api/snapshot?sub=<page>`, a translation made ahead of
 * time from /manage and kept in `page_translations`; the layout stays the
 * page's own, because the English is written into the cells the Portuguese
 * occupied (see
 * `domain/subtitles.ts`). Nothing is translated in the browser.
 *
 * EN is a mode, not a press per page: switched on, it stays on while you change
 * page, and every page that has a translation comes up in English. A page
 * without one shows as it is and the lamp goes dark. Pressing EN on a page that
 * has none — whether the mode was on or not — flashes the lamp red three times
 * and switches the mode off: a key that silently did nothing would read as
 * broken.
 *
 * A visitor who chose English on the front page (an `/en` address) starts with
 * the mode on, so the first page they see is already in English when it has a
 * translation. When it has none the lamp is simply dark — nobody pressed
 * anything, so there is no "no" to flash — and the next page that has English
 * comes up in it.
 *
 * Per viewer, like MIX: in a room the page is shared, the language is not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SignalState } from '../../domain/signal';
import { pageKey } from '../../domain/subpages';
import { translatePage, type SubtitleEntry } from '../../domain/subtitles';
import { SUB_ENABLED } from '../../features';
import type { TeletextPage } from '../../types/teletext';
import { useCurrentLanguage } from './languageContext';

/** How long the red lamp says "no": three 200ms flashes (`.crt-lamp-flash`). */
export const EN_FAULT_MS = 600;

/**
 * One request per page per visit, shared by every set on the screen.
 *
 * A 404 is an answer (`null`), not an error: most pages have no translation.
 * A server with no API (`vite dev`) answers with the app's HTML, which lands
 * there too, through the failed parse.
 */
const loaded = new Map<string, Promise<SubtitleEntry[] | null>>();

function loadSubtitles(key: string): Promise<SubtitleEntry[] | null> {
  let request = loaded.get(key);
  if (request == null) {
    request = fetch(`/api/snapshot?sub=${key}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { runs?: unknown } | null) =>
        Array.isArray(data?.runs) ? (data.runs as SubtitleEntry[]) : null,
      )
      .catch(() => null);
    loaded.set(key, request);
  }
  return request;
}

export interface Subtitles {
  /** The page to draw: in English when EN is on and a translation applies. */
  page: TeletextPage;
  /** What the EN lamp shows. */
  lamp: SignalState;
  toggle: () => void;
}

export function useSubtitles(pageNumber: number, subpage: number, page: TeletextPage): Subtitles {
  const key = String(pageKey(pageNumber, subpage));
  const language = useCurrentLanguage();
  // Read once: switching language mid-page is a navigation, and the set the
  // visitor is holding keeps whatever they last did with the key.
  const [wanted, setWanted] = useState(() => SUB_ENABLED && language === 'en');
  // The page EN was last pressed on, which is the only page allowed to answer
  // "nothing here" with a red lamp.
  const [pressedOn, setPressedOn] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ key: string; entries: SubtitleEntry[] | null } | null>(
    null,
  );

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void loadSubtitles(key).then((entries) => {
      if (current) setAnswer({ key, entries });
    });
    return () => {
      current = false;
    };
  }, [wanted, key]);

  // `undefined` while the answer for this page is still on its way.
  const entries = answer?.key === key ? answer.entries : undefined;
  const english = useMemo(
    () => (wanted && entries != null ? translatePage(page, entries) : null),
    [wanted, entries, page],
  );
  const fault = wanted && entries !== undefined && english == null && pressedOn === key;

  useEffect(() => {
    if (!fault) return;
    const timer = setTimeout(() => {
      setWanted(false);
      setPressedOn(null);
    }, EN_FAULT_MS);
    return () => clearTimeout(timer);
  }, [fault]);

  // The key follows the glass, not the mode: with English showing it turns it
  // off; otherwise it asks for English — including on a page where the mode is
  // already on and simply has nothing, which is where the red lamp answers.
  const showing = english != null;
  const toggle = useCallback(() => {
    setPressedOn(showing ? null : key);
    setWanted(!showing);
  }, [showing, key]);

  const lamp: SignalState = fault
    ? 'no-signal'
    : english != null
      ? 'live'
      : // Blinking amber answers a press; a mode that was on already (an English
        // visitor, or a page change) waits dark, so a page with no English
        // never looks as if it had been on.
        wanted && entries === undefined && pressedOn === key
        ? 'tuning'
        : 'off';

  return { page: english ?? page, lamp, toggle };
}
