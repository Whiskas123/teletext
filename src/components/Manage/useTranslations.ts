/**
 * Which curated pages have English, and the means to give them some.
 *
 * Reads every translation once (`GET /api/snapshot?subs`) and judges each
 * screen against what it says *now*: a translation is stored with the
 * Portuguese it was made from, so a screen edited since is partly covered, and
 * shows as such until it is translated again (see `translationCoverage`).
 *
 * Translating is one request per screen, made by the server with Claude
 * (`POST ?translate`), and takes some seconds each. Several are sent one after
 * another rather than at once — a selection of forty pages is forty requests,
 * and running them in parallel would only trade a queue here for rate limits
 * there.
 *
 * A translation can also be written or corrected by hand (`POST ?sub=`): it is
 * stored the same way, one entry per run, and replaces what the screen had.
 */

import { useCallback, useEffect, useState } from 'react';

import { isArchivePage } from '../../domain/access';
import { pageKey } from '../../domain/subpages';
import {
  englishLines,
  translatePage,
  translationCoverage,
  type SubtitleEntry,
  type SubtitleRun,
} from '../../domain/subtitles';
import type { TeletextPage } from '../../types/teletext';

/** One screen: `null` when there is nothing to translate on it. */
export type ScreenTranslation =
  | { status: 'none' }
  | { status: 'full' | 'partial'; matched: number; total: number };

/** A whole page, over its screens. */
export type PageTranslation = 'full' | 'partial' | 'none';

export interface TranslateOutcome {
  ok: boolean;
  text: string;
}

export interface Translations {
  screen(pageNumber: number, subpage: number): ScreenTranslation | null;
  page(pageNumber: number, screens: number): PageTranslation | null;
  /** The screen as the EN key would show it, or `null` with no English for it. */
  english(pageNumber: number, subpage: number): TeletextPage | null;
  /** Screens among these pages that have text and no translation yet. */
  missing(pages: readonly { pageNumber: number; screens: number }[]): { pageNumber: number; subpage: number }[];
  translate(targets: readonly { pageNumber: number; subpage: number }[]): Promise<TranslateOutcome>;
  /** Every line of a screen that can be translated, with its English now (`''` for none). */
  lines(pageNumber: number, subpage: number): { run: SubtitleRun; en: string }[];
  /** Store English written by hand for a screen; an empty line stays Portuguese. */
  save(pageNumber: number, subpage: number, english: readonly string[]): Promise<TranslateOutcome>;
  /** The screen being translated right now, as `"220.2"`, if any. */
  working: string | null;
  /** How far a batch has got: done of total, while one is running. */
  progress: { done: number; total: number } | null;
}

export function useTranslations(
  livePage: (pageNumber: number, subpage?: number) => TeletextPage | null,
): Translations {
  const [entries, setEntries] = useState<Record<string, SubtitleEntry[]>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let current = true;
    void fetch('/api/snapshot?subs', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { translations?: Record<string, SubtitleEntry[]> } | null) => {
        if (current && data?.translations != null) setEntries(data.translations);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  const screen = useCallback(
    (pageNumber: number, subpage: number): ScreenTranslation | null => {
      if (!isArchivePage(pageNumber)) return null;
      const cells = livePage(pageNumber, subpage);
      if (cells == null) return null;
      const stored = entries[String(pageKey(pageNumber, subpage))];
      const { matched, total } = translationCoverage(cells, stored ?? []);
      if (total === 0) return null;
      if (stored == null) return { status: 'none' };
      return { status: matched === total ? 'full' : 'partial', matched, total };
    },
    [entries, livePage],
  );

  const page = useCallback(
    (pageNumber: number, screens: number): PageTranslation | null => {
      const states = Array.from({ length: screens }, (_, i) => screen(pageNumber, i + 1)).filter(
        (state) => state != null,
      );
      if (states.length === 0) return null;
      if (states.every((state) => state.status === 'full')) return 'full';
      return states.some((state) => state.status !== 'none') ? 'partial' : 'none';
    },
    [screen],
  );

  const english = useCallback(
    (pageNumber: number, subpage: number): TeletextPage | null => {
      const cells = livePage(pageNumber, subpage);
      const stored = entries[String(pageKey(pageNumber, subpage))];
      return cells == null || stored == null ? null : translatePage(cells, stored);
    },
    [entries, livePage],
  );

  const missing = useCallback(
    (pages: readonly { pageNumber: number; screens: number }[]) =>
      pages.flatMap(({ pageNumber, screens }) =>
        Array.from({ length: screens }, (_, i) => ({ pageNumber, subpage: i + 1 })).filter(
          ({ subpage }) => screen(pageNumber, subpage)?.status === 'none',
        ),
      ),
    [screen],
  );

  const translate = useCallback(
    async (targets: readonly { pageNumber: number; subpage: number }[]): Promise<TranslateOutcome> => {
      let done = 0;
      let clipped = 0;
      let lost = 0;
      setProgress({ done, total: targets.length });
      try {
        for (const target of targets) {
          setWorking(String(pageKey(target.pageNumber, target.subpage)));
          const response = await fetch('/api/snapshot?translate', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(target),
          });
          const body = (await response.json().catch(() => ({}))) as {
            key?: string;
            runs?: SubtitleEntry[];
            clipped?: number;
            lost?: number;
            error?: string;
          };
          if (!response.ok || body.key == null || body.runs == null) {
            const where = `${target.pageNumber}${target.subpage > 1 ? ` screen ${target.subpage}` : ''}`;
            const prefix = done > 0 ? `Translated ${done}; stopped at ${where}: ` : `${where}: `;
            return { ok: false, text: prefix + (body.error ?? `request failed (${response.status}).`) };
          }
          const { key, runs } = body;
          setEntries((previous) => ({ ...previous, [key]: runs }));
          clipped += body.clipped ?? 0;
          lost += body.lost ?? 0;
          done += 1;
          setProgress({ done, total: targets.length });
        }
        const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;
        const notes = [
          clipped > 0 ? `${lines(clipped)} cut to fit` : '',
          lost > 0 ? `${lines(lost)} kept in Portuguese because a number went missing` : '',
        ].filter(Boolean);
        const what = done === 1 ? 'Translated' : `Translated ${done} screens`;
        return { ok: true, text: notes.length === 0 ? `${what}.` : `${what} — ${notes.join(', ')}.` };
      } finally {
        setWorking(null);
        setProgress(null);
      }
    },
    [],
  );

  const lines = useCallback(
    (pageNumber: number, subpage: number) => {
      const cells = livePage(pageNumber, subpage);
      return cells == null ? [] : englishLines(cells, entries[String(pageKey(pageNumber, subpage))] ?? []);
    },
    [entries, livePage],
  );

  const save = useCallback(
    async (pageNumber: number, subpage: number, english: readonly string[]): Promise<TranslateOutcome> => {
      const runs = lines(pageNumber, subpage).map(({ run }, i) => ({ row: run.row, col: run.start, en: english[i] ?? '' }));
      try {
        const response = await fetch(`/api/snapshot?sub=${pageKey(pageNumber, subpage)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ runs }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          key?: string;
          runs?: SubtitleEntry[];
          lost?: number;
          error?: string;
        };
        if (!response.ok || body.key == null || body.runs == null) {
          return { ok: false, text: body.error ?? `Not saved (${response.status}).` };
        }
        const { key, runs: stored, lost = 0 } = body;
        setEntries((previous) => {
          const next = { ...previous };
          if (stored.length === 0) delete next[key];
          else next[key] = stored;
          return next;
        });
        if (lost > 0) {
          return {
            ok: true,
            text: `Saved — ${lost} ${lost === 1 ? 'line stays' : 'lines stay'} in Portuguese until ${lost === 1 ? 'it keeps' : 'they keep'} every number.`,
          };
        }
        return { ok: true, text: 'Saved.' };
      } catch {
        return { ok: false, text: 'Could not reach the server.' };
      }
    },
    [lines],
  );

  return { screen, page, english, missing, translate, lines, save, working, progress };
}
