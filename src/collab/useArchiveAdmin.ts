/**
 * useArchiveAdmin — the management screen's data layer.
 *
 * ## Two stores, one view
 *
 * What describes a page on air — its cells, title, role, screen count, and
 * where each screen came from (`page-sources`, see `domain/pageSource.ts`) —
 * lives in the database for the curated archive (100..699) and in playhtml for
 * the playground (`domain/contentStores.ts`). This hook sees both as one set of
 * channels (`useRoutedChannel`), so a publish, a renumbering, a merge or a
 * delete is written as before and each change lands in the store that owns
 * its page. An operation is refused whole, up front, when a store it would
 * touch is not ready (`refusalFor`), so none is left half done.
 *
 * The server is still asked two things: to *render* a capture (its cells with
 * the shift and bottom bar applied — `PUT /api/published`, which records
 * nothing), and to browse the corpus. The curated archive is saved by the
 * archive store (`collab/archiveStore.ts`); the playground's backup is kept by
 * the live mirror (`collab/liveMirror.ts`), which follows playhtml.
 *
 * ## The queries are gated, not unconditional
 *
 * The corpus and the saved menus wait until they are needed, and the capture
 * query is driven by the caller's filters — one owner per value.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePlayContext } from '@playhtml/react';

import { MENU_ROW, applyMenu, type CustomMenu, type MenuDraft } from '../domain/menu';
import { pageToArray, pageToCellMap } from '../domain/pageEncoding';
import { stripPageNumbers } from '../domain/stripPageNumbers';
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
import { loadArchiveFresh, refusalFor, useRoutedChannel } from './archiveStore';
import { getBoot, subscribeBoot } from './bootData';
import { pickStore } from '../domain/contentStores';
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
  type PageKey,
  type SubpageCounts,
} from '../domain/subpages';
import { DEFAULT_PAGE_KIND, type PageKinds } from '../domain/directory';
import { changedEntries, orderedWrites } from '../domain/liveWrites';
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
  | { ok: false; field: 'title' | 'description'; limit: number }
  | { ok: false; field?: undefined; error: string };

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

/** One screen leaving its page for a page of its own, as `replayPlan` applies it. */
interface ScreenSplit {
  /** The page's number before the renumbering, and after it. */
  prior: number;
  page: number;
  screen: number;
  /** How many screens the page had, this one included. */
  count: number;
  /** The number the screen becomes a page at, after the renumbering. */
  at: number;
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
  /**
   * Fold each source's whole carousel onto the end of `target`'s, in order, and
   * leave the sources empty. A move, not a copy — see `domain/absorb.ts`.
   */
  absorbPages(target: number, sources: readonly number[]): Promise<Result>;
  /**
   * Move one screen of a page to another position in its carousel; the screens
   * between shift by one. Positions count from 1, and `to` is where the screen
   * ends up. Its archive source travels with it.
   */
  moveScreen(pageNumber: number, from: number, to: number): Promise<Result>;
  /**
   * Take one screen out of a page and make it a page of its own at `at`, after
   * renumbering by `moves` to make room there; the screens after it close up.
   * One write with the renumbering, not two: the live values here are the
   * render's, so a split read after a separate renumbering would read the old
   * numbers (see {@link absorbPages}).
   */
  splitScreen(pageNumber: number, screen: number, moves: readonly PageMove[], at: number): Promise<Result>;
  /**
   * Take these screens off air, in one pass: each page's other screens close
   * up in order, and a page left with none is deleted.
   */
  removeScreens(screens: readonly { pageNumber: number; screen: number }[]): Promise<Result>;
  /**
   * How many three-digit numbers {@link stripPageNumbers} would blank on these
   * pages, and on how many screens — for the confirmation, before anything goes.
   */
  countPageNumbers(pageNumbers: readonly number[]): { removed: number; screens: number };
  /**
   * Goes up each time translations were moved on the server along with their
   * screens, so whoever holds a copy of them knows to read them again.
   */
  translationsVersion: number;
  /** Blank every three-digit number on every screen of these pages. See `domain/stripPageNumbers.ts`. */
  stripPageNumbers(pageNumbers: readonly number[]): Promise<Result>;
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
  /**
   * Playground screens (700+) the database's copy holds for pages the live
   * document does not have — what a move to a new, empty playhtml room leaves.
   * Zero once every backed-up page is on air, and until playhtml has synced.
   */
  playgroundToRestore: number;
  /**
   * Write those pages, with their titles and the rest, into the live document.
   * A page the live document already has is left alone.
   */
  restorePlayground(): Result;
}

const PAGE_SIZE = 60;

/** A move that went through, whose translations could not follow it. */
const englishLeftBehind = (reason: string): Result => ({
  ok: false,
  error:
    `Done, but the English translations did not follow (${reason}): they may now show on the wrong ` +
    'page. Translate the pages concerned again.',
});

export function useArchiveAdmin({
  admin,
  archiveEnabled,
  filters,
  offset,
}: ArchiveAdminInput): ArchiveAdminApi {
  const { importPages } = useImportPages();
  const { setTitle } = usePageTitles();

  const [menus, setMenus] = useState<CustomMenu[]>([]);
  // The live document, so the screen can show what is on a page right now
  // rather than what the database says was published to it — and so a
  // renumbering can move the content, not just the records.
  //
  // Each channel is the curated archive (from the database) and the playground
  // (from playhtml) as one, and each setter sends what a write changed to the
  // store that owns it (`archiveStore.ts`).
  const [livePages, setPages] = useRoutedChannel<PagesData>(PAGES_CHANNEL, {});
  const [liveTitles, setTitles] = useRoutedChannel<TitlesData>(TITLES_CHANNEL, {});
  const [, setKinds] = useRoutedChannel<PageKinds>(PAGE_KINDS_CHANNEL, {});
  // Descriptions live beside titles rather than only on the publication record,
  // so a page made by hand can have one too.
  const [liveDescriptions, setDescriptions] = useRoutedChannel<DescriptionsData>(
    DESCRIPTIONS_CHANNEL,
    {},
  );
  // How many screens each page holds. Read here for renumbering (a carousel
  // travels with its page) and written through `useSubpages`, which owns the
  // add / remove rules.
  const [liveSubpageCounts, setSubpageCounts] = useRoutedChannel<SubpageCounts>(
    SUBPAGE_COUNTS_CHANNEL,
    {},
  );
  const subpages = useSubpages();
  // Where each archive screen came from, keyed like `pages` and moved with it.
  const [liveSources, setSources] = useRoutedChannel<PageSources>(SOURCES_CHANNEL, {});

  const { isLoading, isProviderMissing } = usePlayContext();
  const liveSynced = !isLoading && !isProviderMissing;
  /**
   * Checked before an operation writes anything, so it is refused whole rather
   * than half-done when one of the stores it spans is not ready.
   */
  const refuse = useCallback(
    (pages: readonly number[]): Result | null => {
      const error = refusalFor(pages, liveSynced);
      return error == null ? null : { ok: false, error };
    },
    [liveSynced],
  );

  // The curated archive is edited from a fresh read of the database, never
  // from the edge's minute-old copy.
  useEffect(() => {
    if (admin) void loadArchiveFresh();
  }, [admin]);

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
   * English and front-page entries are stored by screen number on the server,
   * not in the live document, so a screen that moves must take them along — or
   * the page that moves into its number inherits them. Called after the live
   * writes, with the same moves; `null` drops them. Returns why it failed, if it did.
   */
  const [translationsVersion, setTranslationsVersion] = useState(0);
  const carryTranslations = useCallback(
    async (moves: readonly (readonly [PageKey, PageKey | null])[]): Promise<string | null> => {
      const body = moves
        .map(([from, to]) => ({ from: String(from), to: to == null ? null : String(to) }))
        .filter(({ from, to }) => from !== to);
      if (body.length === 0) return null;
      try {
        const response = await fetch('/api/snapshot?subs-move', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ moves: body }),
        });
        if (!response.ok) {
          const { error } = (await response.json().catch(() => ({}))) as { error?: string };
          return error ?? `the server answered ${response.status}`;
        }
        setTranslationsVersion((version) => version + 1);
        return null;
      } catch {
        return 'the server could not be reached';
      }
    },
    [],
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
      const refused = refuse([pageNumber]);
      if (refused != null) return refused;
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
    [refuse, writeScreen, liveSubpageCounts, setSubpageCounts, setTitle, setDescriptions],
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
   *
   * The screens are replayed on a copy and written in pieces rather than in
   * one transaction: a screen is about 100 KB to send, and a single write
   * moving dozens of them is too big for playhtml's server to accept (see
   * `domain/liveWrites.ts`). Content lands before the screens it left are
   * emptied, so in between a page can show twice but never go missing.
   *
   * With `split`, one screen also leaves its page for a page of its own, in
   * the same pass: the split is applied to the replayed copy, so it reads the
   * numbers the renumbering produced, and each channel is still written once.
   */
  const replayPlan = useCallback(
    (plan: ReorderPlan, split?: ScreenSplit) => {
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
      const keysOf = (page: number) =>
        pageKeys(page, subpageCountOf(liveSubpageCounts, page)).map(String);
      const replayScreens = (draft: Record<string, unknown>) => {
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

      /** The replay on a copy of the screens it reads; the writes that make it so. */
      const screenWrites = (live: Readonly<Record<string, unknown>> | undefined) => {
        const copy: Record<string, unknown> = {};
        const keys = [...plan.lifts, ...plan.moves.map(({ from }) => from)].flatMap(keysOf);
        if (split != null) keys.push(...keysOf(split.prior), String(pageKey(split.at, MIN_SUBPAGE)));
        for (const key of keys) copy[key] = detach(live?.[key]) ?? {};
        replayScreens(copy);
        if (split != null) {
          const at = (screen: number) => String(pageKey(split.page, screen));
          copy[String(pageKey(split.at, MIN_SUBPAGE))] = copy[at(split.screen)] ?? {};
          for (let screen = split.screen; screen < split.count; screen += 1) {
            copy[at(screen)] = copy[at(screen + 1)] ?? {};
          }
          copy[at(split.count)] = {};
        }
        return orderedWrites(changedEntries(copy, live));
      };

      for (const write of screenWrites(livePages as Record<string, unknown>)) {
        setPages((draft) => {
          for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
        });
      }
      for (const write of screenWrites(liveSources)) {
        setSources((draft) => {
          for (const [key, value] of write) draft[key] = value;
        });
      }
      setTitles((draft) => replayInto(draft, ''));
      setDescriptions((draft) => replayInto(draft, ''));
      // A heading that moves stays a heading; its empty value is the default kind.
      setKinds((draft) => replayInto(draft, DEFAULT_PAGE_KIND));
      setSubpageCounts((draft) => {
        replayInto(draft, MIN_SUBPAGE);
        if (split == null) return;
        draft[split.page] = split.count - 1;
        draft[split.at] = MIN_SUBPAGE;
      });
    },
    [
      setPages,
      setSources,
      setTitles,
      setKinds,
      setDescriptions,
      setSubpageCounts,
      livePages,
      liveSources,
      liveSubpageCounts,
    ],
  );

  /**
   * Renumber pages. Checked against what the live document claims, and kept
   * to the one rule the planner does not know: an archive page never lands in
   * the open playground, where any visitor could edit it.
   */
  /**
   * A renumbering checked against what the live document claims, and kept to
   * the one rule the planner does not know: an archive page never lands in the
   * open playground, where any visitor could edit it. No moves is an empty plan.
   */
  const checkArrange = useCallback(
    (moves: readonly PageMove[]): ({ ok: true } & ReorderPlan) | { ok: false; error: string } => {
      if (moves.length === 0) return { ok: true, lifts: [], moves: [], drops: [] };
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
      const refused = refusalFor(
        [...plan.lifts, ...[...plan.moves, ...plan.drops].flatMap(({ from, to }) => [from, to])],
        liveSynced,
      );
      if (refused != null) return { ok: false, error: refused };
      const strays = plan.drops.filter(
        ({ from, to }) => publishedByPage.has(from) && to >= PLAYGROUND_MIN_PAGE,
      );
      if (strays.length > 0) {
        return {
          ok: false,
          error: `That would put archive pages in the open playground (${PLAYGROUND_MIN_PAGE}+).`,
        };
      }
      return plan;
    },
    [occupiedPages, liveSynced, publishedByPage],
  );

  /** Every screen a plan moves, as `[old key, new key]`, read before the replay changes the counts. */
  const plannedScreenMoves = useCallback(
    (plan: ReorderPlan) =>
      [...plan.moves, ...plan.drops].flatMap(({ from, to }) =>
        pageKeys(from, subpageCountOf(liveSubpageCounts, from)).map(
          (key, index) => [key, pageKey(to, index + MIN_SUBPAGE)] as const,
        ),
      ),
    [liveSubpageCounts],
  );

  /** Renumber pages. See {@link checkArrange}. */
  const arrange = useCallback<ArchiveAdminApi['arrange']>(
    async (moves) => {
      const plan = checkArrange(moves);
      if (!plan.ok) return plan;
      const screens = plannedScreenMoves(plan);
      replayPlan(plan);
      const failed = await carryTranslations(screens);
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [checkArrange, plannedScreenMoves, replayPlan, carryTranslations],
  );

  const splitScreen = useCallback<ArchiveAdminApi['splitScreen']>(
    async (pageNumber, screen, moves, at) => {
      const count = subpageCountOf(liveSubpageCounts, pageNumber);
      if (count < 2 || !Number.isInteger(screen) || screen < MIN_SUBPAGE || screen > count) {
        return { ok: false, error: `Page ${pageNumber} has no screen ${screen} to make a page of.` };
      }
      const plan = checkArrange(moves);
      if (!plan.ok) return plan;
      const moved = [...plan.moves, ...plan.drops];
      const page = moved.find(({ from }) => from === pageNumber)?.to ?? pageNumber;
      const taken = new Set(occupiedPages.filter((p) => !moved.some(({ from }) => from === p)));
      for (const { to } of moved) taken.add(to);
      if (taken.has(at)) return { ok: false, error: `Page ${at} is taken.` };
      if (sourceAt(pageNumber, screen) != null && at >= PLAYGROUND_MIN_PAGE) {
        return { ok: false, error: `Archive captures only go on pages 100–${PLAYGROUND_MIN_PAGE - 1}.` };
      }
      const refused = refuse([pageNumber, at]);
      if (refused != null) return refused;

      // The page's own screens go where the split puts them; every other page
      // where the renumbering does.
      const own = new Set(pageKeys(pageNumber, count).map(String));
      const translations = [
        ...plannedScreenMoves(plan).filter(([from]) => !own.has(String(from))),
        ...Array.from({ length: count }, (_, index) => {
          const old = index + MIN_SUBPAGE;
          const to =
            old < screen ? pageKey(page, old) : old === screen ? pageKey(at, MIN_SUBPAGE) : pageKey(page, old - 1);
          return [pageKey(pageNumber, old), to] as const;
        }),
      ].filter(([from, to]) => String(from) !== String(to));

      replayPlan(plan, { prior: pageNumber, page, screen, count, at });
      const failed = await carryTranslations(translations);
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [liveSubpageCounts, checkArrange, occupiedPages, sourceAt, refuse, plannedScreenMoves, replayPlan, carryTranslations],
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
      const refused = refuse([pageNumber]);
      if (refused != null && !refused.ok) return { ok: false, error: refused.error };

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
    [refuse, setTitle, setDescriptions],
  );

  /**
   * Fold pages' carousels onto the end of another's: every screen and its
   * source land after the target's last screen, one source after the other, and
   * the sources are emptied — in one moment, as a move of data inside the live
   * document, written in pieces small enough to arrive (see `domain/liveWrites.ts`).
   *
   * All the sources in one call, not one call each: the live values here are
   * the render's, so a second call in the same tick would read the target's
   * old length and land on the screens the first just wrote. Merging three
   * pages that way kept only the last and emptied all three.
   *
   * The *target's* title and description stay: absorbing 118 into 117 must not
   * retitle 117 as 118.
   */
  const absorbPages = useCallback<ArchiveAdminApi['absorbPages']>(
    async (target, sources) => {
      const refused = refuse([target, ...sources]);
      if (refused != null) return refused;
      const plan: { fromKey: string; toKey: string }[] = [];
      let length = subpageCountOf(liveSubpageCounts, target);
      for (const source of new Set(sources)) {
        if (source === target) continue;
        const moving = subpageCountOf(liveSubpageCounts, source);
        for (let index = 0; index < moving; index += 1) {
          plan.push({
            fromKey: String(pageKey(source, index + MIN_SUBPAGE)),
            toKey: String(pageKey(target, length + index + MIN_SUBPAGE)),
          });
        }
        length += moving;
      }
      const carry = (live: Readonly<Record<string, unknown>> | undefined) => {
        const result: Record<string, unknown> = {};
        for (const { fromKey } of plan) result[fromKey] = {};
        for (const { fromKey, toKey } of plan) {
          const value = live?.[fromKey];
          result[toKey] = value === undefined ? {} : JSON.parse(JSON.stringify(value));
        }
        return orderedWrites(changedEntries(result, live));
      };
      for (const write of carry(livePages as Record<string, unknown>)) {
        setPages((draft) => {
          for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
        });
      }
      for (const write of carry(liveSources)) {
        setSources((draft) => {
          for (const [key, value] of write) draft[key] = value;
        });
      }
      setSubpageCounts((draft) => {
        draft[target] = length;
      });
      for (const source of sources) if (source !== target) clearPageText(source);
      const failed = await carryTranslations(plan.map(({ fromKey, toKey }) => [fromKey, toKey] as const));
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [
      refuse,
      livePages,
      liveSources,
      liveSubpageCounts,
      setPages,
      setSources,
      setSubpageCounts,
      clearPageText,
      carryTranslations,
    ],
  );

  /**
   * The same move of data inside the live document as {@link absorbPages},
   * within one page: each screen key is rewritten with the screen that now
   * belongs there. Front-page entries and translations are keyed by screen
   * number and stay where they are, as they do when a page is renumbered.
   */
  const moveScreen = useCallback<ArchiveAdminApi['moveScreen']>(
    async (pageNumber, from, to) => {
      const count = subpageCountOf(liveSubpageCounts, pageNumber);
      const inRange = (n: number) => Number.isInteger(n) && n >= MIN_SUBPAGE && n <= count;
      if (!inRange(from) || !inRange(to)) {
        return { ok: false, error: `Page ${pageNumber} has screens 1–${count}.` };
      }
      if (from === to) return { ok: true };
      const refused = refuse([pageNumber]);
      if (refused != null) return refused;
      const order = Array.from({ length: count }, (_, index) => index + MIN_SUBPAGE);
      order.splice(to - MIN_SUBPAGE, 0, ...order.splice(from - MIN_SUBPAGE, 1));
      const carry = (live: Readonly<Record<string, unknown>> | undefined) => {
        const result: Record<string, unknown> = {};
        order.forEach((old, index) => {
          const value = live?.[String(pageKey(pageNumber, old))];
          result[String(pageKey(pageNumber, index + MIN_SUBPAGE))] =
            value === undefined ? {} : JSON.parse(JSON.stringify(value));
        });
        return orderedWrites(changedEntries(result, live));
      };
      for (const write of carry(livePages as Record<string, unknown>)) {
        setPages((draft) => {
          for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
        });
      }
      for (const write of carry(liveSources)) {
        setSources((draft) => {
          for (const [key, value] of write) draft[key] = value;
        });
      }
      const failed = await carryTranslations(
        order.map((old, index) => [pageKey(pageNumber, old), pageKey(pageNumber, index + MIN_SUBPAGE)] as const),
      );
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [refuse, livePages, liveSources, liveSubpageCounts, setPages, setSources, carryTranslations],
  );

  const removeScreens = useCallback<ArchiveAdminApi['removeScreens']>(
    async (screens) => {
      const byPage = new Map<number, Set<number>>();
      for (const { pageNumber, screen } of screens) {
        byPage.set(pageNumber, (byPage.get(pageNumber) ?? new Set()).add(screen));
      }
      const refused = refuse([...byPage.keys()]);
      if (refused != null) return refused;

      // What each screen key holds afterwards, and where each one's English goes.
      const plan: { key: string; from: string | null }[] = [];
      const translations: (readonly [PageKey, PageKey | null])[] = [];
      const counts = new Map<number, number>();
      const emptied: number[] = [];
      for (const [pageNumber, removed] of byPage) {
        const count = subpageCountOf(liveSubpageCounts, pageNumber);
        const kept = Array.from({ length: count }, (_, index) => index + MIN_SUBPAGE).filter((s) => !removed.has(s));
        for (let screen = MIN_SUBPAGE; screen <= count; screen += 1) {
          const old = kept[screen - MIN_SUBPAGE];
          plan.push({ key: String(pageKey(pageNumber, screen)), from: old == null ? null : String(pageKey(pageNumber, old)) });
          if (removed.has(screen)) translations.push([pageKey(pageNumber, screen), null]);
        }
        kept.forEach((old, index) => {
          if (old !== index + MIN_SUBPAGE) {
            translations.push([pageKey(pageNumber, old), pageKey(pageNumber, index + MIN_SUBPAGE)]);
          }
        });
        if (kept.length === 0) emptied.push(pageNumber);
        else counts.set(pageNumber, kept.length);
      }
      const carry = (live: Readonly<Record<string, unknown>> | undefined) => {
        const result: Record<string, unknown> = {};
        for (const { key, from } of plan) {
          const value = from == null ? undefined : live?.[from];
          result[key] = value === undefined ? {} : JSON.parse(JSON.stringify(value));
        }
        return orderedWrites(changedEntries(result, live));
      };
      for (const write of carry(livePages as Record<string, unknown>)) {
        setPages((draft) => {
          for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
        });
      }
      for (const write of carry(liveSources)) {
        setSources((draft) => {
          for (const [key, value] of write) draft[key] = value;
        });
      }
      setSubpageCounts((draft) => {
        for (const [pageNumber, count] of counts) draft[pageNumber] = count;
        for (const pageNumber of emptied) draft[pageNumber] = MIN_SUBPAGE;
      });
      if (emptied.length > 0) {
        setTitles((draft) => {
          for (const pageNumber of emptied) draft[pageNumber] = '';
        });
        setDescriptions((draft) => {
          for (const pageNumber of emptied) draft[pageNumber] = '';
        });
        setKinds((draft) => {
          for (const pageNumber of emptied) draft[pageNumber] = DEFAULT_PAGE_KIND;
        });
      }
      const failed = await carryTranslations(translations);
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [
      refuse,
      liveSubpageCounts,
      livePages,
      liveSources,
      setPages,
      setSources,
      setSubpageCounts,
      setTitles,
      setDescriptions,
      setKinds,
      carryTranslations,
    ],
  );

  /**
   * Each screen of these pages with its three-digit numbers blanked, keyed as
   * the live document keys them; screens with none are left out. A screen
   * carrying a saved bottom bar keeps that row: its numbers were set by hand.
   */
  const planStrip = useCallback(
    (pageNumbers: readonly number[]) => {
      const writes: [string, unknown][] = [];
      let removed = 0;
      for (const pageNumber of new Set(pageNumbers)) {
        for (let subpage = MIN_SUBPAGE; subpage <= subpageCountOf(liveSubpageCounts, pageNumber); subpage += 1) {
          const key = String(pageKey(pageNumber, subpage));
          const stored = livePages?.[key as unknown as number];
          if (stored == null) continue;
          const keepRow = sourceAt(pageNumber, subpage)?.menuId != null ? MENU_ROW : null;
          const stripped = stripPageNumbers(pageToArray(stored), keepRow);
          if (stripped.removed === 0) continue;
          removed += stripped.removed;
          writes.push([key, pageToCellMap(stripped.page)]);
        }
      }
      return { writes, removed };
    },
    [livePages, liveSubpageCounts, sourceAt],
  );

  const countPageNumbers = useCallback<ArchiveAdminApi['countPageNumbers']>(
    (pageNumbers) => {
      const { writes, removed } = planStrip(pageNumbers);
      return { removed, screens: writes.length };
    },
    [planStrip],
  );

  /**
   * Whole screens are written, not the changed cells: the same shape every
   * other bulk write here uses. Known ceiling: a visitor drawing on one of
   * these playground screens at that moment can lose their last stroke.
   */
  const stripPageNumbersOf = useCallback<ArchiveAdminApi['stripPageNumbers']>(
    async (pageNumbers) => {
      const refused = refuse(pageNumbers);
      if (refused != null) return refused;
      for (const write of orderedWrites(planStrip(pageNumbers).writes)) {
        setPages((draft) => {
          for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
        });
      }
      return { ok: true };
    },
    [refuse, planStrip, setPages],
  );

  /** Remove a page entirely: every screen, where each came from, and its text. */
  const deletePage = useCallback<ArchiveAdminApi['deletePage']>(
    async (pageNumber) => {
      const refused = refuse([pageNumber]);
      if (refused != null) return refused;
      const keys = pageKeys(pageNumber, subpageCountOf(liveSubpageCounts, pageNumber)).map(String);
      setPages((draft) => {
        for (const key of keys) (draft as Record<string, unknown>)[key] = {};
      });
      setSources((draft) => {
        for (const key of keys) draft[key] = {};
      });
      clearPageText(pageNumber);
      const failed = await carryTranslations(keys.map((key) => [key, null] as const));
      return failed == null ? { ok: true } : englishLeftBehind(failed);
    },
    [refuse, liveSubpageCounts, setPages, setSources, clearPageText, carryTranslations],
  );

  /* --- the old table ------------------------------------------------------- */

  /* --- after a move to a new room ------------------------------------------ */

  const boot = useSyncExternalStore(subscribeBoot, getBoot, getBoot);
  /**
   * Every page seen on air during this visit. The backup is read once, at load,
   * so a page deleted since — from here or by a visitor — is still in it; one
   * that was on air and went is a deletion, not something a room move left
   * behind, and is never offered back.
   *
   * Accumulated during render (React's "state from props" pattern) rather than
   * frozen at the sync: for one render after it the live pages are still empty.
   */
  const [seenOnAir, setSeenOnAir] = useState<ReadonlySet<number>>(() => new Set());
  if (occupiedPages.some((page) => !seenOnAir.has(page))) setSeenOnAir(new Set([...seenOnAir, ...occupiedPages]));
  /**
   * Backed-up playground entries of one channel, for pages not on air.
   *
   * Page by page rather than "only when the playground is empty": a visitor
   * creating a page in the new room takes the lowest free number, and the
   * moment one did, an all-or-nothing restore would have been withheld for
   * every other page — while each new page went on to overwrite the backup of
   * the one that used to have its number.
   */
  const missingPlayground = useCallback(
    (record: unknown): Record<string, unknown> => {
      const entries = pickStore(record as Record<string, unknown> | undefined, false);
      return Object.fromEntries(
        Object.entries(entries).filter(([key]) => {
          const page = parsePageKey(key)?.pageNumber;
          return page != null && !occupiedSet.has(page) && !seenOnAir.has(page);
        }),
      );
    },
    [occupiedSet, seenOnAir],
  );
  const backupPlayground = useMemo(() => missingPlayground(boot?.pages), [missingPlayground, boot]);
  const playgroundToRestore = liveSynced ? Object.keys(backupPlayground).length : 0;

  const restorePlayground = useCallback((): Result => {
    const refused = refuse([PLAYGROUND_MIN_PAGE]);
    if (refused != null) return refused;
    if (boot == null) return { ok: false, error: 'The backup has not loaded yet.' };
    const playground = missingPlayground;
    // Screens in pieces small enough for playhtml's server, as every bulk write.
    for (const write of orderedWrites(changedEntries(backupPlayground, livePages as Record<string, unknown>))) {
      setPages((draft) => {
        for (const [key, value] of write) (draft as Record<string, unknown>)[key] = value;
      });
    }
    const sources = playground(boot['page-sources']);
    for (const write of orderedWrites(changedEntries(sources, liveSources))) {
      setSources((draft) => {
        for (const [key, value] of write) draft[key] = value;
      });
    }
    setTitles((draft) => Object.assign(draft, playground(boot.titles)));
    setKinds((draft) => Object.assign(draft, playground(boot['page-kinds'])));
    setDescriptions((draft) => Object.assign(draft, playground(boot.descriptions)));
    setSubpageCounts((draft) => Object.assign(draft, playground(boot['subpage-counts'])));
    return { ok: true };
  }, [
    refuse,
    boot,
    missingPlayground,
    backupPlayground,
    livePages,
    liveSources,
    setPages,
    setSources,
    setTitles,
    setKinds,
    setDescriptions,
    setSubpageCounts,
  ]);

  return {
    captures,
    total,
    published,
    publishedByPage,
    publicationAt,
    isEdited,
    subpageCountOfPage,
    addSubpage: subpages.addSubpage,
    absorbPages,
    moveScreen,
    splitScreen,
    removeScreens,
    translationsVersion,
    countPageNumbers,
    stripPageNumbers: stripPageNumbersOf,
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
    playgroundToRestore,
    restorePlayground,
  };
}
