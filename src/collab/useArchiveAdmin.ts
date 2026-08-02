/**
 * useArchiveAdmin — the management screen's data layer.
 *
 * Publishing lands in two stores and the split is deliberate (see
 * `api/published.ts`): the database records *which capture is on which page and
 * why*, playhtml carries the content visitors read. Only a connected browser
 * can write the Yjs document, so the server records the decision and hands back
 * the cells, and this hook completes the job with `useImportPages` — the same
 * whole-page, one-transaction write the import screen already uses.
 *
 * Keeping that sequence here, rather than in the component, means the screen
 * never has to remember that publishing is two writes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { applyMenu, type CustomMenu, type MenuDraft } from '../domain/menu';
import { pageToArray } from '../domain/pageEncoding';
import { shiftPageDown } from '../domain/pageTransform';
import type { ReorderPlan } from '../domain/reorder';
import { useGuide } from './useGuide';
import { useImportPages } from './useImportPages';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import type { PagesData, TeletextPage, TitlesData } from './types';

/** A capture as the list endpoint returns it — metadata only, no cells. */
export interface CaptureSummary {
  id: number;
  source: 'rtp' | 'sic';
  original_page: number;
  sub: string;
  sub_index: number | null;
  topic: string | null;
  topic_group: string | null;
  topic_source: 'folder' | 'manifest';
  scheme: string | null;
  first_seen: string | null;
  last_seen: string | null;
  capture_count: number;
  tier: string | null;
  bucket: string | null;
  manifest_title: string | null;
  decode_status: 'ok' | 'unsupported-profile' | 'failed';
  profile: string | null;
  width: number;
  height: number;
  snapped_pixels: number;
  unknown_glyphs: number;
  corpus_file: string;
  /** Whether the archive holds a render for this capture, for the browser. */
  has_image: boolean;
}

/** One published slot, joined with the capture behind it. */
export interface PublishedEntry {
  page_number: number;
  capture_id: number;
  title: string;
  description: string;
  published_at: string;
  source: 'rtp' | 'sic';
  original_page: number;
  sub: string;
  topic: string | null;
  scheme: string | null;
  first_seen: string | null;
  manifest_title: string | null;
  /** Transforms this page was published with, so they can be re-applied. */
  shift_down: boolean;
  menu_id: number | null;
  menu_name: string | null;
}

/** What a publication does to a capture on its way to the page. */
export interface PublishTransforms {
  /** Move every row down one, dropping the last. */
  shiftDown: boolean;
  /** Saved menu to write over the last row, or `null` to keep the capture's. */
  menuId: number | null;
}

export interface CaptureFilters {
  source?: string;
  topic?: string;
  topicGroup?: string;
  scheme?: string;
  page?: number;
  q?: string;
  undecoded?: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

/** Build a query string, omitting anything unset. */
function queryString(filters: CaptureFilters, limit: number, offset: number): string {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.topicGroup) params.set('topicGroup', filters.topicGroup);
  if (filters.scheme) params.set('scheme', filters.scheme);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.q) params.set('q', filters.q);
  if (filters.undecoded) params.set('undecoded', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return params.toString();
}

export interface ArchiveAdminApi {
  captures: CaptureSummary[];
  total: number;
  published: PublishedEntry[];
  menus: CustomMenu[];
  loading: boolean;
  error: string | null;
  /** How many captures one page of results holds. */
  pageSize: number;
  /** Re-run the capture query with new filters. */
  search(filters: CaptureFilters, offset?: number): void;
  /** Fetch one capture's cells, for previewing. */
  loadPage(captureId: number): Promise<TeletextPage | null>;
  /**
   * What is on `pageNumber` right now, read from the live document — not from
   * the database, so it reflects any collaborative edits since publication.
   * `null` when the page is empty.
   */
  livePage(pageNumber: number): TeletextPage | null;
  /**
   * Apply the publish-time transforms to a page, exactly as the server will.
   * Lets the screen preview the real outcome before anything is written.
   */
  transform(page: TeletextPage, transforms: PublishTransforms): TeletextPage;
  /** Record the assignment, then write the cells into playhtml. */
  publish(input: {
    pageNumber: number;
    captureId: number;
    title: string;
    description: string;
    transforms: PublishTransforms;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Clear the record and blank the page in playhtml. */
  unpublish(pageNumber: number): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Create or update a saved menu. */
  saveMenu(draft: MenuDraft & { id?: number }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Remove a saved menu. Published pages keep their cells. */
  deleteMenu(id: number): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Make room at `fromPage` by pushing it and everything above it by `delta`.
   * Renumbers the records and replays the same moves on the live document.
   */
  shiftPages(fromPage: number, delta: number): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Move one published page to another number, sliding the pages between. */
  movePage(fromPage: number, toPage: number): Promise<{ ok: true } | { ok: false; error: string }>;
}

const PAGE_SIZE = 60;

export function useArchiveAdmin(): ArchiveAdminApi {
  const { importPages } = useImportPages();
  const { setTitle } = useGuide();

  const [published, setPublished] = useState<PublishedEntry[]>([]);
  const [menus, setMenus] = useState<CustomMenu[]>([]);
  // The live document, so the screen can show what is on a page right now
  // rather than what the database says was published to it — and so a
  // renumbering can move the content, not just the records.
  const [livePages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [, setTitles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [query, setQuery] = useState<{ filters: CaptureFilters; offset: number }>({
    filters: {},
    offset: 0,
  });

  /** The query as a string; also the identity of the result that answers it. */
  const queryKey = queryString(query.filters, PAGE_SIZE, query.offset);

  /**
   * The last completed response, tagged with the query it answered.
   *
   * Loading is derived from whether that tag still matches the current query,
   * rather than held in its own state and flipped at the top of the effect.
   * Setting state synchronously in an effect body causes a second render pass
   * before the browser paints, for a value that was already knowable.
   */
  const [result, setResult] = useState<{
    key: string;
    captures: CaptureSummary[];
    total: number;
    error: string | null;
  } | null>(null);

  const loading = result?.key !== queryKey;
  const captures = result?.key === queryKey ? result.captures : [];
  const total = result?.key === queryKey ? result.total : 0;
  const error = result?.key === queryKey ? result.error : null;

  useEffect(() => {
    let cancelled = false;

    getJson<{ captures: CaptureSummary[]; total: number }>(`/api/captures?${queryKey}`)
      .then((body) => {
        if (cancelled) return;
        setResult({
          key: queryKey,
          captures: body.captures,
          total: body.total,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key: queryKey,
          captures: [],
          total: 0,
          error:
            cause instanceof Error ? cause.message : 'Could not load the archive.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const reloadPublished = useCallback(() => {
    getJson<{ published: PublishedEntry[] }>('/api/published')
      .then((body) => setPublished(body.published))
      .catch(() => setPublished([]));
  }, []);

  useEffect(reloadPublished, [reloadPublished]);

  const reloadMenus = useCallback(() => {
    getJson<{ menus: CustomMenu[] }>('/api/menus')
      .then((body) => setMenus(body.menus))
      .catch(() => setMenus([]));
  }, []);

  useEffect(reloadMenus, [reloadMenus]);

  const search = useCallback((filters: CaptureFilters, offset = 0) => {
    setQuery({ filters, offset });
  }, []);

  /** Menus by id, so a publication's transforms can be resolved cheaply. */
  const menusById = useMemo(
    () => new Map(menus.map((menu) => [menu.id, menu])),
    [menus],
  );

  const livePage = useCallback(
    (pageNumber: number): TeletextPage | null => {
      const stored = livePages?.[pageNumber];
      if (stored == null) return null;
      const page = pageToArray(stored);
      // An entry that normalises to nothing is an empty slot, not content.
      return page.some((cell) => cell.char !== ' ' || cell.graphics != null)
        ? page
        : null;
    },
    [livePages],
  );

  /**
   * Mirror of what `api/published.ts` does on publish, in the same order and
   * from the same domain functions — shift first so the menu lands on a row
   * the shift will not then move away.
   */
  const transform = useCallback(
    (page: TeletextPage, { shiftDown, menuId }: PublishTransforms): TeletextPage => {
      let result = shiftDown ? shiftPageDown(page) : page;
      const menu = menuId == null ? undefined : menusById.get(menuId);
      if (menu != null) result = applyMenu(result, menu);
      return result;
    },
    [menusById],
  );

  const loadPage = useCallback(async (captureId: number): Promise<TeletextPage | null> => {
    try {
      const body = await getJson<{ cells: unknown }>(`/api/captures/${captureId}`);
      return body.cells == null ? null : pageToArray(body.cells);
    } catch {
      return null;
    }
  }, []);

  const publish = useCallback<ArchiveAdminApi['publish']>(
    async ({ pageNumber, captureId, title, description, transforms }) => {
      try {
        const response = await fetch('/api/published', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageNumber,
            captureId,
            title,
            description,
            // The server re-applies these rather than trusting cells from the
            // client, so what is stored and what is shown cannot diverge.
            shiftDown: transforms.shiftDown,
            menuId: transforms.menuId,
          }),
        });
        const body = (await response.json()) as { error?: string; cells?: unknown };

        if (!response.ok) {
          return { ok: false, error: body.error ?? `Publish failed (${response.status}).` };
        }

        // Second half: the content itself. The record already exists, so a
        // failure here leaves the page recorded but not showing — recoverable
        // by re-publishing, and reported rather than swallowed.
        const written = importPages([
          { pageNumber, page: pageToArray(body.cells) },
        ]);
        if (written === 0) {
          return {
            ok: false,
            error: 'Recorded, but the page could not be written to the live document. Try publishing again.',
          };
        }

        setTitle(pageNumber, title);
        reloadPublished();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [importPages, setTitle, reloadPublished],
  );

  const unpublish = useCallback<ArchiveAdminApi['unpublish']>(
    async (pageNumber) => {
      try {
        const response = await fetch(`/api/published/${pageNumber}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: body.error ?? `Unpublish failed (${response.status}).`,
          };
        }

        // Blank the live page too, so an unpublished slot stops showing content.
        importPages([{ pageNumber, page: pageToArray(undefined) }]);
        setTitle(pageNumber, '');
        reloadPublished();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [importPages, setTitle, reloadPublished],
  );

  const saveMenu = useCallback<ArchiveAdminApi['saveMenu']>(
    async (draft) => {
      try {
        const response = await fetch('/api/menus', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `Save failed (${response.status}).` };
        }
        reloadMenus();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [reloadMenus],
  );

  const deleteMenu = useCallback<ArchiveAdminApi['deleteMenu']>(
    async (id) => {
      try {
        const response = await fetch(`/api/menus?id=${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `Delete failed (${response.status}).` };
        }
        reloadMenus();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [reloadMenus],
  );

  /**
   * Replay a renumbering plan against the live document.
   *
   * The server has already renumbered the records and returned the plan; this
   * makes the identical moves on the `pages` and `titles` channels so the two
   * stores stay in step. Order is not ours to choose — each destination is only
   * free because the step before it vacated one — so this walks the plan
   * exactly as given.
   *
   * The whole replay is a single playhtml mutation. Done as separate writes,
   * a peer could observe the document mid-shuffle, with a page briefly missing.
   */
  const replayPlan = useCallback(
    (plan: ReorderPlan) => {
      setPages((draft) => {
        const held = plan.lift == null ? undefined : draft[plan.lift];
        if (plan.lift != null) delete draft[plan.lift];
        for (const { from, to } of plan.moves) {
          draft[to] = draft[from];
          delete draft[from];
        }
        if (plan.drop != null && held !== undefined) draft[plan.drop] = held;
      });
      setTitles((draft) => {
        const held = plan.lift == null ? undefined : draft[plan.lift];
        if (plan.lift != null) delete draft[plan.lift];
        for (const { from, to } of plan.moves) {
          if (draft[from] === undefined) delete draft[to];
          else draft[to] = draft[from];
          delete draft[from];
        }
        if (plan.drop != null && held !== undefined) draft[plan.drop] = held;
      });
    },
    [setPages, setTitles],
  );

  const reorder = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const response = await fetch('/api/reorder', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { error?: string } & ReorderPlan;
        if (!response.ok) {
          return { ok: false as const, error: body.error ?? `Failed (${response.status}).` };
        }
        replayPlan({ lift: body.lift, moves: body.moves, drop: body.drop });
        reloadPublished();
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: 'Could not reach the server.' };
      }
    },
    [replayPlan, reloadPublished],
  );

  const shiftPages = useCallback<ArchiveAdminApi['shiftPages']>(
    (fromPage, delta) => reorder({ action: 'shift', fromPage, delta }),
    [reorder],
  );

  const movePage = useCallback<ArchiveAdminApi['movePage']>(
    (fromPage, toPage) => reorder({ action: 'move', fromPage, toPage }),
    [reorder],
  );

  return {
    captures,
    total,
    published,
    menus,
    loading,
    error,
    pageSize: PAGE_SIZE,
    search,
    loadPage,
    livePage,
    transform,
    publish,
    unpublish,
    saveMenu,
    deleteMenu,
    shiftPages,
    movePage,
  };
}
