/**
 * useArchiveAdmin — the management screen's data layer.
 *
 * ## One store for the service
 *
 * Everything that describes what is on air lives in playhtml: the cells, the
 * titles, the roles, the screen counts — and, since the publication map moved
 * out of the database, where each archive screen came from (`page-sources`, see
 * `domain/pageSource.ts`). A publish, a renumbering, a merge or a delete is a
 * set of writes to that one document made in the same moment, so no step can
 * finish while another is left undone.
 *
 * The server is still asked two things: to *render* a capture (its cells with
 * the shift and bottom bar applied — `PUT /api/published`, which records
 * nothing), and to browse the corpus. The database's copy of the pages is kept
 * by the live mirror (`collab/liveMirror.ts`), which follows playhtml; nothing
 * here writes it.
 *
 * The old table, `published_pages`, is read once, so its records can be moved
 * into playhtml (`legacy` below). After that it is history.
 *
 * ## The queries are gated, not unconditional
 *
 * The corpus and the saved menus wait until they are needed, and the capture
 * query is driven by the caller's filters — one owner per value.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { applyMenu, type CustomMenu, type MenuDraft } from '../domain/menu';
import { pageToArray } from '../domain/pageEncoding';
import { hasVisibleContent } from '../domain/pageOps';
import { shiftPageDown } from '../domain/pageTransform';
import { MAX_DESCRIPTION_LENGTH } from '../domain/publication';
import { validateTitle } from '../domain/titles';
import { PLAYGROUND_MIN_PAGE } from '../domain/access';
import {
  SOURCES_CHANNEL,
  cellsDigest,
  editedSincePublished,
  readSource,
  type PageSource,
  type PageSources,
} from '../domain/pageSource';
import { planArrange, type PageMove, type ReorderPlan } from '../domain/reorder';
import { usePageTitles } from './useGuide';
import { useImportPages } from './useImportPages';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { DESCRIPTIONS_CHANNEL, type DescriptionsData } from './usePageText';
import { useOccupiedPages } from './useOccupiedPages';
import { useSubpages } from './useSubpages';
import {
  MIN_SUBPAGE,
  SUBPAGE_COUNTS_CHANNEL,
  pageKey,
  pageKeys,
  parsePageKey,
  subpageCountOf,
  type SubpageCounts,
} from '../domain/subpages';
import { DEFAULT_PAGE_KIND, type PageKinds } from '../domain/directory';
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
  /** Where it is published, as `"page/screen"`; empty when it is not. */
  published_to?: string[];
  /** Captures of the same page slot and topic, this one included. */
  versions?: number;
  /** How many screens its page had when it was captured. */
  story_size?: number;
}

/** One published slot, joined with the capture behind it. */
export interface PublishedEntry {
  page_number: number;
  /**
   * Which screen of the page's carousel this record is for; 1 is the page
   * itself. Optional on the way in, because a record written before subpages
   * existed has no column value the client can rely on until it reloads.
   */
  subpage?: number;
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
  /** Hide captures already published somewhere. */
  unpublished?: boolean;
  /** One capture per page slot, the most recent. */
  latest?: boolean;
  sort?: 'newest' | 'oldest';
}

/** Saving a page's text refuses before it writes anything. */
export type SavePageTextResult =
  | { ok: true }
  | { ok: false; field: 'title' | 'description'; limit: number };

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
  if (filters.unpublished) params.set('unpublished', 'true');
  if (filters.latest) params.set('latest', 'true');
  if (filters.sort) params.set('sort', filters.sort);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return params.toString();
}

/** What the screen is showing, which decides what is worth fetching. */
export interface ArchiveAdminInput {
  /**
   * Whether the visitor is a signed-in moderator. Nothing is fetched otherwise —
   * every one of these endpoints would answer 401.
   */
  admin: boolean;
  /**
   * Whether the archive side has been opened at least once this load. Gates the
   * corpus and the saved menus, which the on-air side never reads.
   */
  archiveEnabled: boolean;
  /** The capture query. Debouncing belongs to the caller, not to the fetch. */
  filters: CaptureFilters;
  offset: number;
}

type Result = { ok: true } | { ok: false; error: string };

/** The old publication table, and moving its records into playhtml. */
export interface LegacyRecords {
  /** Records whose screen is on air but has no source yet: to be moved in. */
  adoptable: PublishedEntry[];
  /** Records whose screen is empty: restore from the archive, or discard. */
  stranded: PublishedEntry[];
  loading: boolean;
  error: string | null;
  reload(): void;
  /**
   * Store where a screen came from, in playhtml, from its old record — with
   * the fingerprint of the capture as it would be published, so a screen
   * edited since shows as edited.
   */
  adopt(record: PublishedEntry, rendered: PublishedRender): void;
  /** Mark records as dealt with, so they stop being offered. */
  resolve(records: readonly PublishedEntry[]): Promise<Result>;
}

/** A capture as `PUT /api/published` renders it. */
export interface PublishedRender {
  cells: Record<string, unknown>;
  source: Omit<PageSource, 'cellsDigest'>;
}

export interface ArchiveAdminApi {
  captures: CaptureSummary[];
  total: number;
  /** Every archive screen on air, from `page-sources`, in page order. */
  published: PublishedEntry[];
  /** The first archive screen of each page. Later screens: {@link publicationAt}. */
  publishedByPage: ReadonlyMap<number, PublishedEntry>;
  /** Where one screen came from, or null when it was made by hand. */
  publicationAt(pageNumber: number, subpage: number): PublishedEntry | null;
  /** Whether an archive screen has been edited by hand since it was published. */
  isEdited(pageNumber: number, subpage: number): boolean;
  /** How many screens `pageNumber` holds in the live document. Always at least 1. */
  subpageCountOfPage(pageNumber: number): number;
  /** Append an empty screen to a page; returns its number, or null at the cap. */
  addSubpage(pageNumber: number): number | null;
  /** Drop a page's last screen and where it came from; returns the new count, or null at 1. */
  removeLastSubpage(pageNumber: number): Promise<number | null>;
  /**
   * Fold `source`'s whole carousel onto the end of `target`'s, and leave
   * `source` empty. A move, not a copy — see `domain/absorb.ts`.
   */
  absorbPage(target: number, source: number): Promise<Result>;
  menus: CustomMenu[];
  loading: boolean;
  error: string | null;
  /** How many captures one page of results holds. */
  pageSize: number;
  /** Re-issue the current capture query unchanged, after a failure. */
  retryCaptures(): void;
  /** Fetch one capture's cells, for previewing. */
  loadPage(captureId: number): Promise<TeletextPage | null>;
  /** Every screen of the story a capture belongs to, in screen order. */
  loadStory(captureId: number): Promise<CaptureSummary[]>;
  /** Render a capture as it would be published, without publishing it. */
  render(captureId: number, transforms: PublishTransforms): Promise<PublishedRender | null>;
  /**
   * What is on `pageNumber` right now, read from the live document. `null`
   * when the screen draws nothing.
   */
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  /**
   * Apply the publish-time transforms to a page, exactly as the server will.
   * Lets the screen preview the real outcome before anything is written.
   */
  transform(page: TeletextPage, transforms: PublishTransforms): TeletextPage;
  /**
   * Render the capture on the server, then write its cells and where they came
   * from into playhtml together.
   */
  publish(input: {
    pageNumber: number;
    /** Screen of the page's carousel to publish onto, defaulting to the first. */
    subpage?: number;
    captureId: number;
    title: string;
    description: string;
    transforms: PublishTransforms;
  }): Promise<Result>;
  /** Create or update a saved menu. */
  saveMenu(draft: MenuDraft & { id?: number }): Promise<Result>;
  /** Remove a saved menu. Published pages keep their cells. */
  deleteMenu(id: number): Promise<Result>;
  /**
   * Renumber an explicit set of pages at once, each to the number given —
   * what a drag in the page list works out (see `domain/lineup.ts`). Checked
   * by `planArrange`, then replayed on every channel in one moment.
   */
  arrange(moves: readonly PageMove[]): Promise<Result>;
  /** Remove a page entirely: every screen, where each came from, and its text. */
  deletePage(pageNumber: number): Promise<Result>;
  /** The live title of a page, whether or not it came from the archive. */
  titleOf(pageNumber: number): string;
  /** The live description of a page. */
  descriptionOf(pageNumber: number): string;
  /**
   * Set a page's title and description in the live document, refusing both if
   * either is over its limit — a partial save would leave the operator unsure
   * which half landed.
   */
  savePageText(pageNumber: number, title: string, description: string): SavePageTextResult;
  /** Every page number the live document claims, ascending. */
  occupiedPages: number[];
  /** Live pages with no archive screen. */
  handMadePages: number[];
  /** The old publication table, while it still has records to move in. */
  legacy: LegacyRecords;
}

const PAGE_SIZE = 60;

export function useArchiveAdmin({
  admin,
  archiveEnabled,
  filters,
  offset,
}: ArchiveAdminInput): ArchiveAdminApi {
  const { importPages } = useImportPages();
  const { setTitle } = usePageTitles();

  // The old publication table, read once to move its records into playhtml.
  const [legacyRows, setLegacyRows] = useState<PublishedEntry[]>([]);
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [menus, setMenus] = useState<CustomMenu[]>([]);
  // The live document, so the screen can show what is on a page right now
  // rather than what the database says was published to it — and so a
  // renumbering can move the content, not just the records.
  const [livePages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [liveTitles, setTitles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [, setKinds] = usePageData<PageKinds>(PAGE_KINDS_CHANNEL, {});
  // Descriptions live beside titles rather than only on the publication record,
  // so a page made by hand can have one too.
  const [liveDescriptions, setDescriptions] = usePageData<DescriptionsData>(
    DESCRIPTIONS_CHANNEL,
    {},
  );
  // How many screens each page holds. Read here for renumbering (a carousel
  // travels with its page) and written through `useSubpages`, which owns the
  // add / remove rules.
  const [liveSubpageCounts, setSubpageCounts] = usePageData<SubpageCounts>(
    SUBPAGE_COUNTS_CHANNEL,
    {},
  );
  const subpages = useSubpages();
  // Where each archive screen came from, keyed like `pages` and moved with it.
  const [liveSources, setSources] = usePageData<PageSources>(SOURCES_CHANNEL, {});

  /** The query as a string; also the identity of the result that answers it. */
  const queryKey = queryString(filters, PAGE_SIZE, offset);
  const capturesEnabled = admin && archiveEnabled;

  /**
   * A retry counter, deliberately outside the query key.
   *
   * Retrying has to re-fetch the *same* URL, so it cannot be a query parameter;
   * but it does have to make the screen look busy again, so the stored result
   * carries the attempt it answered as well as the query.
   */
  const [attempt, setAttempt] = useState(0);

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
    attempt: number;
    captures: CaptureSummary[];
    total: number;
    error: string | null;
  } | null>(null);

  const answered = result?.key === queryKey && result.attempt === attempt;
  // Nothing is loading while the query is switched off, or there would be a
  // permanent spinner on a tab that never asked for anything.
  const loading = capturesEnabled && !answered;
  const captures = answered ? result.captures : [];
  const total = answered ? result.total : 0;
  const error = answered ? result.error : null;

  useEffect(() => {
    if (!capturesEnabled) return;
    let cancelled = false;

    getJson<{ captures: CaptureSummary[]; total: number }>(`/api/captures?${queryKey}`)
      .then((body) => {
        if (cancelled) return;
        setResult({
          key: queryKey,
          attempt,
          captures: body.captures,
          total: body.total,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key: queryKey,
          attempt,
          captures: [],
          total: 0,
          error:
            cause instanceof Error ? cause.message : 'Could not load the archive.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [queryKey, attempt, capturesEnabled]);

  const retryCaptures = useCallback(() => setAttempt((n) => n + 1), []);

  const reloadLegacy = useCallback(() => {
    if (!admin) return;
    getJson<{ published: PublishedEntry[] }>('/api/published')
      .then((body) => {
        setLegacyRows(body.published);
        setLegacyError(null);
      })
      .catch((cause: unknown) => {
        setLegacyError(
          cause instanceof Error ? cause.message : 'Could not read the old publication records.',
        );
      })
      .finally(() => setLegacyLoading(false));
  }, [admin]);

  useEffect(reloadLegacy, [reloadLegacy]);

  // Loaded for both tabs, unlike the corpus: the on-air side offers a bulk change
  // of the menu strip, so it needs the list of saved menus to offer. It is a
  // handful of rows, not three thousand captures.
  const reloadMenus = useCallback(() => {
    if (!admin) return;
    getJson<{ menus: CustomMenu[] }>('/api/menus')
      .then((body) => setMenus(body.menus))
      .catch(() => setMenus([]));
  }, [admin]);

  useEffect(reloadMenus, [reloadMenus]);

  /** Menus by id, so a publication's transforms can be resolved cheaply. */
  const menusById = useMemo(
    () => new Map(menus.map((menu) => [menu.id, menu])),
    [menus],
  );

  const subpageCountOfPage = useCallback(
    (pageNumber: number): number => subpageCountOf(liveSubpageCounts, pageNumber),
    [liveSubpageCounts],
  );

  /**
   * Every page number the live document claims: something drawn on screen 1,
   * a title, or a heading role. Sources do not claim a number on their own — a
   * source whose screen was emptied describes nothing on air.
   */
  const occupiedPages = useOccupiedPages();
  const occupiedSet = useMemo(() => new Set(occupiedPages), [occupiedPages]);

  const titleOf = useCallback(
    (pageNumber: number): string => {
      const value = liveTitles?.[pageNumber];
      return typeof value === 'string' ? value : '';
    },
    [liveTitles],
  );

  const descriptionOf = useCallback(
    (pageNumber: number): string => {
      const value = liveDescriptions?.[pageNumber];
      return typeof value === 'string' ? value : '';
    },
    [liveDescriptions],
  );

  const sourceAt = useCallback(
    (pageNumber: number, subpage: number): PageSource | null =>
      readSource(liveSources?.[String(pageKey(pageNumber, subpage))]),
    [liveSources],
  );

  /**
   * The archive screens on air, as the page list reads them: one entry per
   * screen that has a source, on a page the live document claims, within its
   * carousel. The shape is the one the old table's rows had, so every reader of
   * "where did this come from" kept working when the store moved.
   */
  const published = useMemo(() => {
    const entries: PublishedEntry[] = [];
    for (const [key, raw] of Object.entries(liveSources ?? {})) {
      const parsed = parsePageKey(key);
      const source = readSource(raw);
      if (parsed == null || source == null) continue;
      const { pageNumber, subpage } = parsed;
      if (!occupiedSet.has(pageNumber)) continue;
      if (subpage > subpageCountOf(liveSubpageCounts, pageNumber)) continue;
      entries.push({
        page_number: pageNumber,
        subpage,
        capture_id: source.captureId,
        title: titleOf(pageNumber),
        description: descriptionOf(pageNumber),
        published_at: source.publishedAt,
        source: source.source,
        original_page: source.originalPage,
        sub: source.sub,
        topic: source.topic,
        scheme: source.scheme,
        first_seen: source.firstSeen,
        manifest_title: source.manifestTitle,
        shift_down: source.shiftDown,
        menu_id: source.menuId,
        menu_name: source.menuName,
      });
    }
    return entries.sort(
      (a, b) => a.page_number - b.page_number || (a.subpage ?? 1) - (b.subpage ?? 1),
    );
  }, [liveSources, occupiedSet, liveSubpageCounts, titleOf, descriptionOf]);

  const publishedByPage = useMemo(() => {
    const map = new Map<number, PublishedEntry>();
    for (const entry of published) {
      if (!map.has(entry.page_number)) map.set(entry.page_number, entry);
    }
    return map;
  }, [published]);

  const publishedBySubpage = useMemo(
    () => new Map(published.map((entry) => [`${entry.page_number}.${entry.subpage ?? 1}`, entry])),
    [published],
  );

  const publicationAt = useCallback(
    (pageNumber: number, subpage: number): PublishedEntry | null =>
      publishedBySubpage.get(`${pageNumber}.${subpage}`) ?? null,
    [publishedBySubpage],
  );

  /** Live pages with no archive screen — someone's own work. */
  const handMadePages = useMemo(
    () => occupiedPages.filter((page) => !publishedByPage.has(page)),
    [occupiedPages, publishedByPage],
  );

  const livePage = useCallback(
    (pageNumber: number, subpage: number = MIN_SUBPAGE): TeletextPage | null => {
      const stored = livePages?.[pageKey(pageNumber, subpage) as number];
      if (stored == null) return null;
      const page = pageToArray(stored);
      // A screen that draws nothing is an empty slot, not content: the card
      // shows the same blank either way, and saying "no content" is the more
      // useful of the two — it is what tells the operator this is a number to
      // clear rather than a page to keep. Same test the reader's navigation
      // uses, so what a card calls empty and what the PAGE keys skip cannot
      // drift apart again.
      return hasVisibleContent(page) ? page : null;
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

  const loadStory = useCallback(async (captureId: number): Promise<CaptureSummary[]> => {
    try {
      const body = await getJson<{ captures: CaptureSummary[] }>(`/api/captures?story=${captureId}`);
      return body.captures;
    } catch {
      return [];
    }
  }, []);

  /**
   * Everything a page keeps in the live document, cleared together.
   *
   * Unpublishing used to blank the cells and the title and stop there, leaving
   * the description and the directory role behind. A page marked `category`
   * therefore stayed *occupied* — `useOccupiedPages` counts a heading as a claim
   * — so it kept its slot in the pages list and in the Yellow Pages with no
   * title and no content, and no control left on it to fix that. Delete already
   * cleared all four; unpublish now does the same.
   *
   * Emptied, not deleted: playhtml's draft is a Proxy with no `deleteProperty`
   * trap, so `delete` throws and aborts the whole mutation. Every reader treats
   * a blank value and an absent key identically.
   */
  const clearPageText = useCallback(
    (pageNumber: number) => {
      setTitles((draft) => {
        draft[pageNumber] = '';
      });
      setDescriptions((draft) => {
        draft[pageNumber] = '';
      });
      setKinds((draft) => {
        draft[pageNumber] = DEFAULT_PAGE_KIND;
      });
      // Back to a carousel of one, or the page would keep claiming screens it
      // no longer has and the viewer would show `1/4` on an empty page.
      setSubpageCounts((draft) => {
        draft[pageNumber] = MIN_SUBPAGE;
      });
    },
    [setTitles, setDescriptions, setKinds, setSubpageCounts],
  );

  /** Render a capture as it would be published; records nothing. */
  const render = useCallback<ArchiveAdminApi['render']>(
    async (captureId, transforms) => {
      try {
        const response = await fetch('/api/published', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          // The page number is only checked for range here; it is what the
          // endpoint validates, and nothing is recorded against it.
          body: JSON.stringify({
            pageNumber: 100,
            subpage: MIN_SUBPAGE,
            captureId,
            title: '',
            description: '',
            shiftDown: transforms.shiftDown,
            menuId: transforms.menuId,
          }),
        });
        if (!response.ok) return null;
        return (await response.json()) as PublishedRender;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Write one screen: its cells and where they came from, together. `source`
   * null clears the source — a screen made by hand has none.
   */
  const writeScreen = useCallback(
    (pageNumber: number, subpage: number, cells: unknown, source: PageSource | null): boolean => {
      const written = importPages([{ pageNumber, subpage, page: pageToArray(cells) }]);
      if (written === 0) return false;
      setSources((draft) => {
        // Emptied rather than deleted: playhtml's draft cannot delete a key.
        draft[String(pageKey(pageNumber, subpage))] = source ?? {};
      });
      return true;
    },
    [importPages, setSources],
  );

  const publish = useCallback<ArchiveAdminApi['publish']>(
    async ({ pageNumber, subpage = MIN_SUBPAGE, captureId, title, description, transforms }) => {
      try {
        const response = await fetch('/api/published', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          // The server re-applies the transforms rather than trusting cells
          // from the client, so what is shown is exactly the render.
          body: JSON.stringify({
            pageNumber,
            subpage,
            captureId,
            title,
            description,
            shiftDown: transforms.shiftDown,
            menuId: transforms.menuId,
          }),
        });
        const body = (await response.json()) as { error?: string } & Partial<PublishedRender>;
        if (!response.ok || body.cells == null || body.source == null) {
          return { ok: false, error: body.error ?? `Publish failed (${response.status}).` };
        }

        // Everything below happens in this one moment, with no request in
        // between: the cells, where they came from, the title and the
        // carousel length land together or not at all.
        const source: PageSource = { ...body.source, cellsDigest: cellsDigest(body.cells) };
        if (!writeScreen(pageNumber, subpage, body.cells, source)) {
          return { ok: false, error: 'The page could not be written to the live document.' };
        }
        // Publishing onto a screen the carousel does not reach yet grows it;
        // it never shrinks one.
        if (subpage > subpageCountOf(liveSubpageCounts, pageNumber)) {
          setSubpageCounts((draft) => {
            draft[pageNumber] = subpage;
          });
        }
        setTitle(pageNumber, title);
        setDescriptions((draft) => {
          draft[pageNumber] = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [writeScreen, liveSubpageCounts, setSubpageCounts, setTitle, setDescriptions],
  );

  /** Take a page's last screen off air, with where it came from. */
  const removeLastSubpage = useCallback<ArchiveAdminApi['removeLastSubpage']>(
    async (pageNumber) => {
      const count = subpageCountOf(liveSubpageCounts, pageNumber);
      if (count <= MIN_SUBPAGE) return null;
      setSources((draft) => {
        draft[String(pageKey(pageNumber, count))] = {};
      });
      return subpages.removeLastSubpage(pageNumber);
    },
    [liveSubpageCounts, setSources, subpages],
  );

  const isEdited = useCallback(
    (pageNumber: number, subpage: number): boolean => {
      const source = sourceAt(pageNumber, subpage);
      return source != null && editedSincePublished(source, livePages?.[pageKey(pageNumber, subpage) as number]);
    },
    [sourceAt, livePages],
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
   * Order is not ours to choose — each destination is only free because the
   * step before it vacated one — so this walks the plan exactly as given, over
   * every channel keyed by page number: the cells and their sources per screen,
   * the title, description, role and screen count per page. All of it in this
   * one moment, with nothing awaited in between.
   */
  const replayPlan = useCallback(
    (plan: ReorderPlan) => {
      /**
       * Take a value out of the draft as plain data. Reading `draft[page]`
       * gives a reference *into* the document; holding one across the write
       * that follows stored nothing, which is how moving a page once made it
       * disappear. A structural copy detaches it.
       */
      const detach = <T,>(value: T): T | undefined =>
        value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);

      /** Vacating writes an empty value: playhtml's draft cannot delete a key. */
      const replayInto = <T,>(draft: Record<number, T>, empty: T) => {
        const held = new Map<number, T>();
        for (const page of plan.lifts) {
          held.set(page, detach(draft[page]) ?? empty);
          draft[page] = empty;
        }
        for (const { from, to } of plan.moves) {
          draft[to] = detach(draft[from]) ?? empty;
          draft[from] = empty;
        }
        for (const { from, to } of plan.drops) {
          draft[to] = held.get(from) ?? empty;
        }
      };

      /**
       * The same replay over a page's whole carousel: screens 2+ live under
       * composite keys (`"220.2"`), and how many to carry is read from the
       * counts *before* they are themselves replayed.
       */
      const replayScreens = (draft: Record<string, unknown>) => {
        const keysOf = (page: number) =>
          pageKeys(page, subpageCountOf(liveSubpageCounts, page)).map(String);
        const held = new Map<number, unknown[]>();
        for (const page of plan.lifts) {
          const keys = keysOf(page);
          held.set(page, keys.map((key) => detach(draft[key]) ?? {}));
          for (const key of keys) draft[key] = {};
        }
        for (const { from, to } of plan.moves) {
          const keys = keysOf(from);
          const carried = keys.map((key) => detach(draft[key]) ?? {});
          for (const key of keys) draft[key] = {};
          carried.forEach((value, index) => {
            draft[String(pageKey(to, index + 1))] = value;
          });
        }
        for (const { from, to } of plan.drops) {
          (held.get(from) ?? []).forEach((value, index) => {
            draft[String(pageKey(to, index + 1))] = value;
          });
        }
      };

      setPages((draft) => replayScreens(draft as Record<string, unknown>));
      setSources((draft) => replayScreens(draft));
      setTitles((draft) => replayInto(draft, ''));
      setDescriptions((draft) => replayInto(draft, ''));
      // A heading that moves stays a heading; its empty value is the default kind.
      setKinds((draft) => replayInto(draft, DEFAULT_PAGE_KIND));
      setSubpageCounts((draft) => replayInto(draft, MIN_SUBPAGE));
    },
    [setPages, setSources, setTitles, setKinds, setDescriptions, setSubpageCounts, liveSubpageCounts],
  );

  /**
   * Renumber pages. Checked against what the live document claims, and kept
   * to the one rule the planner does not know: an archive page never lands in
   * the open playground, where any visitor could edit it.
   */
  const arrange = useCallback<ArchiveAdminApi['arrange']>(
    async (moves) => {
      const plan = planArrange(occupiedPages, moves);
      if (!plan.ok) {
        return {
          ok: false,
          error:
            plan.reason === 'blocked'
              ? `Pages already there: ${(plan.blocking ?? []).slice(0, 8).join(', ')}.`
              : 'That renumbering is not possible.',
        };
      }
      const strays = plan.drops.filter(
        ({ from, to }) => publishedByPage.has(from) && to >= PLAYGROUND_MIN_PAGE,
      );
      if (strays.length > 0) {
        return {
          ok: false,
          error: `That would put archive pages in the open playground (${PLAYGROUND_MIN_PAGE}+).`,
        };
      }
      replayPlan(plan);
      return { ok: true };
    },
    [occupiedPages, publishedByPage, replayPlan],
  );

  const savePageText = useCallback<ArchiveAdminApi['savePageText']>(
    (pageNumber, nextTitle, nextDescription) => {
      // Validated before either write, so an over-length value reaches neither
      // store and the operator is not left guessing which half saved.
      const title = validateTitle(nextTitle);
      if (!title.ok) {
        return { ok: false, field: 'title', limit: 60 };
      }
      const description = nextDescription.trim();
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return { ok: false, field: 'description', limit: MAX_DESCRIPTION_LENGTH };
      }

      // One key per page in each channel, so two people editing different
      // pages never collide — the same shape titles already had.
      setTitle(pageNumber, title.value);
      setDescriptions((draft) => {
        // Empty string rather than removing the key: deleting throws on
        // playhtml's draft, and an empty description reads the same anyway.
        draft[pageNumber] = description;
      });
      return { ok: true };
    },
    [setTitle, setDescriptions],
  );

  /**
   * Fold one page's carousel onto the end of another's: every screen and its
   * source land after the target's last screen, and the source page is
   * emptied — in one moment, as a move of data inside the live document.
   *
   * This used to re-publish each screen through the server one at a time, so a
   * failure half way left a story duplicated across two pages. There is no
   * request in the middle any more, so there is no half way.
   *
   * The *target's* title and description stay: absorbing 118 into 117 must not
   * retitle 117 as 118.
   */
  const absorbPage = useCallback<ArchiveAdminApi['absorbPage']>(
    async (target, source) => {
      const from = subpageCountOf(liveSubpageCounts, target);
      const moving = subpageCountOf(liveSubpageCounts, source);
      const carry = (draft: Record<string, unknown>) => {
        for (let index = 0; index < moving; index += 1) {
          const fromKey = String(pageKey(source, index + MIN_SUBPAGE));
          const value = draft[fromKey];
          draft[String(pageKey(target, from + index + MIN_SUBPAGE))] =
            value === undefined ? {} : JSON.parse(JSON.stringify(value));
          draft[fromKey] = {};
        }
      };
      setPages((draft) => carry(draft as Record<string, unknown>));
      setSources((draft) => carry(draft));
      setSubpageCounts((draft) => {
        draft[target] = from + moving;
      });
      clearPageText(source);
      return { ok: true };
    },
    [liveSubpageCounts, setPages, setSources, setSubpageCounts, clearPageText],
  );

  /** Remove a page entirely: every screen, where each came from, and its text. */
  const deletePage = useCallback<ArchiveAdminApi['deletePage']>(
    async (pageNumber) => {
      const keys = pageKeys(pageNumber, subpageCountOf(liveSubpageCounts, pageNumber)).map(String);
      setPages((draft) => {
        for (const key of keys) (draft as Record<string, unknown>)[key] = {};
      });
      setSources((draft) => {
        for (const key of keys) draft[key] = {};
      });
      clearPageText(pageNumber);
      return { ok: true };
    },
    [liveSubpageCounts, setPages, setSources, clearPageText],
  );

  /* --- the old table ------------------------------------------------------- */

  /**
   * Its records, split by what can be done with them. A record whose screen
   * already has a source for the same capture has been moved in; one whose
   * screen is on air is ready to move in; one whose screen is empty needs a
   * decision.
   */
  const legacySplit = useMemo(() => {
    const adoptable: PublishedEntry[] = [];
    const stranded: PublishedEntry[] = [];
    for (const record of legacyRows) {
      const subpage = record.subpage ?? MIN_SUBPAGE;
      if (sourceAt(record.page_number, subpage)?.captureId === record.capture_id) continue;
      const onAir =
        occupiedSet.has(record.page_number) && livePage(record.page_number, subpage) != null;
      (onAir ? adoptable : stranded).push(record);
    }
    return { adoptable, stranded };
  }, [legacyRows, sourceAt, occupiedSet, livePage]);

  const adopt = useCallback<LegacyRecords['adopt']>(
    (record, rendered) => {
      const subpage = record.subpage ?? MIN_SUBPAGE;
      const source: PageSource = {
        ...rendered.source,
        // When it was published, not now: this is history being carried over.
        publishedAt: record.published_at,
        cellsDigest: cellsDigest(rendered.cells),
      };
      setSources((draft) => {
        draft[String(pageKey(record.page_number, subpage))] = source;
      });
    },
    [setSources],
  );

  const resolve = useCallback<LegacyRecords['resolve']>(
    async (records) => {
      if (records.length === 0) return { ok: true };
      try {
        const response = await fetch('/api/published', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            records: records.map((r) => [r.page_number, r.subpage ?? MIN_SUBPAGE]),
          }),
        });
        if (!response.ok) return { ok: false, error: `The old records could not be updated (${response.status}).` };
        const done = new Set(records.map((r) => `${r.page_number}.${r.subpage ?? MIN_SUBPAGE}`));
        setLegacyRows((rows) => rows.filter((r) => !done.has(`${r.page_number}.${r.subpage ?? MIN_SUBPAGE}`)));
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [],
  );

  const legacy = useMemo<LegacyRecords>(
    () => ({
      adoptable: legacySplit.adoptable,
      stranded: legacySplit.stranded,
      loading: legacyLoading,
      error: legacyError,
      reload: reloadLegacy,
      adopt,
      resolve,
    }),
    [legacySplit, legacyLoading, legacyError, reloadLegacy, adopt, resolve],
  );

  return {
    captures,
    total,
    published,
    publishedByPage,
    publicationAt,
    isEdited,
    subpageCountOfPage,
    addSubpage: subpages.addSubpage,
    removeLastSubpage,
    absorbPage,
    menus,
    loading,
    error,
    pageSize: PAGE_SIZE,
    retryCaptures,
    loadPage,
    loadStory,
    render,
    livePage,
    transform,
    publish,
    saveMenu,
    deleteMenu,
    arrange,
    deletePage,
    titleOf,
    descriptionOf,
    savePageText,
    occupiedPages,
    handMadePages,
    legacy,
  };
}
