/**
 * useEnglishDraft — the editor's English mode: a curated screen's translation,
 * edited in the grid it is drawn in.
 *
 * The English is not a page of its own. It is the Portuguese page with the
 * words of its translated lines swapped (see `domain/subtitles.ts`), stored as
 * one entry per line. So in English only the letters of those lines can
 * change: an edit anywhere else, or to a colour or a graphic, has nowhere to be
 * stored and is refused (`editCell` answers `false`).
 *
 * Saved like the rest of the editor, as you go — a moment after typing stops,
 * or at once when the screen changes — through `POST /api/snapshot?sub=` as a
 * translation made by hand. A line whose words are still the Portuguese ones is
 * left out unless it already had English, so a screen that was partly
 * translated stays partly translated.
 *
 * Moderators only: translations are read through `?subs`, which is theirs and
 * never cached, so a screen reopened after a save shows that save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isArchivePage } from '../../domain/access';
import { pageKey } from '../../domain/subpages';
import { subtitleRuns, translatePage, type SubtitleEntry } from '../../domain/subtitles';
import { COLS, type Cell, type TeletextPage } from '../../types/teletext';

/** How long after the last keystroke the English is saved. */
const SAVE_AFTER_MS = 800;

export interface EnglishDraft {
  /** The screen in English, or `null` when it has no translation to edit. */
  page: TeletextPage | null;
  /** Change one cell's letter. `false` when the cell is not part of a translated line. */
  editCell(index: number, cell: Cell): boolean;
  /** Why the last save failed, or `null`. */
  saveError: string | null;
}

interface Pending {
  key: string;
  page: TeletextPage;
  portuguese: TeletextPage;
  stored: SubtitleEntry[];
}

export function useEnglishDraft(
  pageNumber: number,
  subpage: number,
  portuguese: TeletextPage,
  moderator: boolean,
): EnglishDraft {
  const key = String(pageKey(pageNumber, subpage));
  const [translations, setTranslations] = useState<Record<string, SubtitleEntry[]>>({});
  const [draft, setDraft] = useState<{ key: string; page: TeletextPage } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!moderator) return;
    let current = true;
    void fetch('/api/snapshot?subs', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { translations?: Record<string, SubtitleEntry[]> } | null) => {
        if (current && data?.translations != null) setTranslations(data.translations);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [moderator]);

  const stored = isArchivePage(pageNumber) ? translations[key] : undefined;
  const english = useMemo(
    () => (stored == null ? null : translatePage(portuguese, stored)),
    [portuguese, stored],
  );
  const page = draft?.key === key ? draft.page : english;
  const runs = useMemo(() => subtitleRuns(portuguese), [portuguese]);

  const save = useCallback(async ({ key: target, page: cells, portuguese: source, stored: before }: Pending) => {
    const lines = subtitleRuns(source).flatMap((run) => {
      const en = cells
        .slice(run.row * COLS + run.start, run.row * COLS + run.end)
        .map((cell) => cell.char)
        .join('')
        .trim();
      const had = before.some((e) => e.row === run.row && e.col === run.start && e.pt === run.text);
      return en !== run.text || had ? [{ row: run.row, col: run.start, en }] : [];
    });
    try {
      const response = await fetch(`/api/snapshot?sub=${target}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runs: lines }),
      });
      const body = (await response.json().catch(() => ({}))) as { runs?: SubtitleEntry[]; error?: string };
      if (!response.ok || body.runs == null) {
        setSaveError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const saved = body.runs;
      setTranslations((previous) => ({ ...previous, [target]: saved }));
      setSaveError(null);
    } catch {
      setSaveError('no connection');
    }
  }, []);

  const flush = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next != null) void save(next);
  }, [save]);

  // Moving to another screen, or leaving, saves what was typed rather than
  // waiting for a timer that belongs to the screen being left.
  useEffect(() => flush, [key, flush]);

  const editCell = useCallback(
    (index: number, cell: Cell): boolean => {
      const row = Math.floor(index / COLS);
      const col = index % COLS;
      const inLine = runs.some((run) => run.row === row && col >= run.start && col < run.end);
      if (page == null || stored == null || !inLine) return false;
      const next = page.slice();
      next[index] = { ...page[index], char: cell.char };
      setDraft({ key, page: next });
      pending.current = { key, page: next, portuguese, stored };
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
      return true;
    },
    [runs, page, stored, key, portuguese, flush],
  );

  return { page, editCell, saveError };
}
