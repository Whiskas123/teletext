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
 *
 * ## The queries are gated, not unconditional
 *
 * This used to fire `/api/captures`, `/api/published` and `/api/menus` on mount
 * whatever the operator came to do — so opening `/manage` to nudge one page
 * queried the whole corpus. The caller now says what is on screen, and only the
 * publication records load for both tabs; the corpus and the saved menus wait
 * until the archive tab has actually been opened.
 *
 * The capture query itself is driven by the caller's filters rather than by a
 * `search()` call that set a second copy of them in here. One owner per value:
 * the panel holds the filters, this hook holds the answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { applyMenu, type CustomMenu, type MenuDraft } from '../domain/menu';
import { pageToArray } from '../domain/pageEncoding';
import { shiftPageDown } from '../domain/pageTransform';
import { MAX_DESCRIPTION_LENGTH } from '../domain/publication';
import { validateTitle } from '../domain/titles';
import type { ReorderPlan } from '../domain/reorder';
import { useGuide } from './useGuide';
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

export interface ArchiveAdminApi {
  captures: CaptureSummary[];
  total: number;
  published: PublishedEntry[];
  /**
   * Publication records by page number, derived once for every reader.
   *
   * One record per page — the *first* screen's — because every existing reader
   * asks this map a question about a page: is it from the archive, may it join
   * a bulk transform, what capture is behind it. A carousel's later screens are
   * reached through {@link publicationAt} instead, so adding subpages did not
   * change what any of those readers were already asking.
   */
  publishedByPage: ReadonlyMap<number, PublishedEntry>;
  /** The record for one screen of a page, or null when that screen is not published. */
  publicationAt(pageNumber: number, subpage: number): PublishedEntry | null;
  /** How many screens `pageNumber` holds in the live document. Always at least 1. */
  subpageCountOfPage(pageNumber: number): number;
  /** Append an empty screen to a page; returns its number, or null at the cap. */
  addSubpage(pageNumber: number): number | null;
  /** Drop a page's last screen and its record; returns the new count, or null at 1. */
  removeLastSubpage(pageNumber: number): Promise<number | null>;
  menus: CustomMenu[];
  loading: boolean;
  error: string | null;
  /**
   * Why the publication records could not be loaded, or null. Separate from
   * `error` because an empty list and a failed load are not the same thing:
   * showing "no pages on air" when the request failed invites deleting pages
   * that are perfectly fine.
   */
  publishedError: string | null;
  /** How many captures one page of results holds. */
  pageSize: number;
  /** Re-issue the current capture query unchanged, after a failure. */
  retryCaptures(): void;
  /** Re-issue the publication load, after a failure. */
  reloadPublished(): void;
  /** Fetch one capture's cells, for previewing. */
  loadPage(captureId: number): Promise<TeletextPage | null>;
  /**
   * What is on `pageNumber` right now, read from the live document — not from
   * the database, so it reflects any collaborative edits since publication.
   * `null` when the page is empty.
   */
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  /**
   * Apply the publish-time transforms to a page, exactly as the server will.
   * Lets the screen preview the real outcome before anything is written.
   */
  transform(page: TeletextPage, transforms: PublishTransforms): TeletextPage;
  /** Record the assignment, then write the cells into playhtml. */
  publish(input: {
    pageNumber: number;
    /** Screen of the page's carousel to publish onto, defaulting to the first. */
    subpage?: number;
    captureId: number;
    title: string;
    description: string;
    transforms: PublishTransforms;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Clear the records and blank every screen of the page in playhtml. */
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
  /**
   * Move the run of pages in `[blockStart, blockEnd]` so it begins at
   * `destination`, sliding whatever it passes over to close the gap. A single
   * page is a block of one.
   */
  moveBlock(
    blockStart: number,
    blockEnd: number,
    destination: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Remove a page entirely: its content, title, heading role and description,
   * plus its publication record when it has one.
   */
  deletePage(pageNumber: number): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The live title of a page, whether or not it came from the archive. */
  titleOf(pageNumber: number): string;
  /** The live description of a page. */
  descriptionOf(pageNumber: number): string;
  /**
   * Set a page's title and description in the live document, refusing both if
   * either is over its limit — a partial save would leave the operator unsure
   * which half landed.
   */
  savePageText(
    pageNumber: number,
    title: string,
    description: string,
  ): SavePageTextResult;
  /** Every page holding content, from either store, ascending. */
  occupiedPages: number[];
  /** Live pages that hold content but were not published from the archive. */
  handMadePages: number[];
}

const PAGE_SIZE = 60;

export function useArchiveAdmin({
  admin,
  archiveEnabled,
  filters,
  offset,
}: ArchiveAdminInput): ArchiveAdminApi {
  const { importPages } = useImportPages();
  const { setTitle } = useGuide();

  const [published, setPublished] = useState<PublishedEntry[]>([]);
  const [publishedError, setPublishedError] = useState<string | null>(null);
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

  const reloadPublished = useCallback(() => {
    if (!admin) return;
    getJson<{ published: PublishedEntry[] }>('/api/published')
      .then((body) => {
        setPublished(body.published);
        setPublishedError(null);
      })
      .catch((cause: unknown) => {
        // The last good list is kept rather than blanked: an empty pages list
        // reads as "nothing is on air", which is a lie a failed request should
        // not be allowed to tell.
        setPublishedError(
          cause instanceof Error
            ? cause.message
            : 'Could not load which pages are published.',
        );
      });
  }, [admin]);

  useEffect(reloadPublished, [reloadPublished]);

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

  /**
   * Records by page number, derived once here rather than in each reader.
   *
   * The list arrives ordered by page then subpage, so the *first* record seen
   * for a page is its first screen — which is the one every reader of this map
   * means. Later screens do not overwrite it.
   */
  const publishedByPage = useMemo(() => {
    const map = new Map<number, PublishedEntry>();
    for (const entry of published) {
      if (!map.has(entry.page_number)) map.set(entry.page_number, entry);
    }
    return map;
  }, [published]);

  /** Records by page *and* screen, for the controls that name a subpage. */
  const publishedBySubpage = useMemo(
    () =>
      new Map(
        published.map((entry) => [
          String(pageKey(entry.page_number, entry.subpage ?? MIN_SUBPAGE)),
          entry,
        ]),
      ),
    [published],
  );

  const publicationAt = useCallback(
    (pageNumber: number, subpage: number): PublishedEntry | null =>
      publishedBySubpage.get(String(pageKey(pageNumber, subpage))) ?? null,
    [publishedBySubpage],
  );

  const subpageCountOfPage = useCallback(
    (pageNumber: number): number => subpageCountOf(liveSubpageCounts, pageNumber),
    [liveSubpageCounts],
  );

  /**
   * Every page number holding content in the live document.
   *
   * Read from playhtml rather than from the publication records, because those
   * two sets are not the same: the seeded pages, anything edited by hand and
   * the whole playground exist here and nowhere else. Reordering has to know
   * about them or it will move a page onto one and destroy it.
   *
   * An entry that normalises to an empty page is an empty slot, not content —
   * clearing a page leaves the key behind.
   */
  const occupiedPages = useOccupiedPages();

  /** Live pages with no publication record — someone's own work. */
  const handMadePages = useMemo(
    () => occupiedPages.filter((page) => !publishedByPage.has(page)),
    [occupiedPages, publishedByPage],
  );

  const livePage = useCallback(
    (pageNumber: number, subpage: number = MIN_SUBPAGE): TeletextPage | null => {
      const stored = livePages?.[pageKey(pageNumber, subpage) as number];
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

  const publish = useCallback<ArchiveAdminApi['publish']>(
    async ({ pageNumber, subpage = MIN_SUBPAGE, captureId, title, description, transforms }) => {
      try {
        const response = await fetch('/api/published', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageNumber,
            subpage,
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
          { pageNumber, subpage, page: pageToArray(body.cells) },
        ]);
        if (written === 0) {
          return {
            ok: false,
            error: 'Recorded, but the page could not be written to the live document. Try publishing again.',
          };
        }

        // Publishing onto a screen the carousel does not reach yet grows it, so
        // the arrows can actually get to what was just published. Never
        // shrinks: publishing to screen 2 of a four-screen page is a
        // replacement, not a truncation.
        if (subpage > subpageCountOf(liveSubpageCounts, pageNumber)) {
          setSubpageCounts((draft) => {
            draft[pageNumber] = subpage;
          });
        }

        setTitle(pageNumber, title);
        setDescriptions((draft) => {
          draft[pageNumber] = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
        });
        reloadPublished();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [
      importPages,
      setTitle,
      setDescriptions,
      reloadPublished,
      liveSubpageCounts,
      setSubpageCounts,
    ],
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

        // Blank every screen, so an unpublished slot stops showing content.
        // Blanking only the first would leave the rest of a carousel on air
        // under a page number the archive no longer claims.
        const blank = pageToArray(undefined);
        importPages(
          Array.from(
            { length: subpageCountOf(liveSubpageCounts, pageNumber) },
            (_, index) => ({ pageNumber, subpage: index + 1, page: blank }),
          ),
        );
        clearPageText(pageNumber);
        reloadPublished();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [importPages, clearPageText, reloadPublished, liveSubpageCounts],
  );

  /**
   * Take a page's last screen off air: its record, then its content.
   *
   * The record goes first for the same reason a delete does — a screen still
   * recorded as published but blank is a lie the screen cannot see, whereas a
   * removed record with content still live is visible and fixable from here.
   * A missing record is not a failure: a screen added by hand never had one.
   */
  const removeLastSubpage = useCallback<ArchiveAdminApi['removeLastSubpage']>(
    async (pageNumber) => {
      const count = subpageCountOf(liveSubpageCounts, pageNumber);
      if (count <= MIN_SUBPAGE) return null;

      if (publicationAt(pageNumber, count) != null) {
        await fetch(`/api/published/${pageNumber}?subpage=${count}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        }).catch(() => undefined);
        reloadPublished();
      }

      return subpages.removeLastSubpage(pageNumber);
    },
    [liveSubpageCounts, publicationAt, reloadPublished, subpages],
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
      /**
       * Take a value out of the draft as plain data.
       *
       * Reading `draft[page]` gives a reference *into* the document, not a
       * copy. Holding one across the `delete` that follows leaves a reference
       * to something no longer in the document, and writing it back at the new
       * number stored nothing — which is why moving a page one place with the
       * arrows made it disappear rather than move. Cells, titles and kinds are
       * all plain data, so a structural copy detaches them completely.
       */
      const detach = <T,>(value: T): T | undefined =>
        value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);

      /**
       * Vacating a page writes an empty value; it never deletes the key.
       *
       * playhtml's draft is a Proxy with no `deleteProperty` trap, so `delete
       * draft[page]` throws "unable to delete property" and aborts the whole
       * mutation — which is what made moving a page one place lose it.
       *
       * Writing empty is equivalent to every reader anyway: `normalizePage`
       * turns `{}` into a blank page, `guideEntries` does not list a blank
       * page with an empty title, and `useOccupiedPages` counts neither. So an
       * emptied key and an absent one mean the same thing everywhere.
       */
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
       * The same replay over a page's whole carousel.
       *
       * A page's later screens live under composite keys (`"220.2"`), so the
       * plain replay above — which reads `draft[220]` — would move screen 1 and
       * leave the rest sitting at the old number, where the next page to arrive
       * there would inherit them. How many screens to carry is read from the
       * counts map *before* it is itself replayed, since that map is what says
       * how long each carousel is.
       */
      const replayPageContent = (draft: Record<number, unknown>) => {
        const keysOf = (page: number) =>
          pageKeys(page, subpageCountOf(liveSubpageCounts, page));
        const held = new Map<number, unknown[]>();

        for (const page of plan.lifts) {
          const keys = keysOf(page);
          held.set(page, keys.map((key) => detach(draft[key as number]) ?? {}));
          for (const key of keys) draft[key as number] = {};
        }
        for (const { from, to } of plan.moves) {
          const keys = keysOf(from);
          const carried = keys.map((key) => detach(draft[key as number]) ?? {});
          for (const key of keys) draft[key as number] = {};
          carried.forEach((cells, index) => {
            draft[pageKey(to, index + 1) as number] = cells;
          });
        }
        for (const { from, to } of plan.drops) {
          (held.get(from) ?? []).forEach((cells, index) => {
            draft[pageKey(to, index + 1) as number] = cells;
          });
        }
      };

      setPages((draft) => replayPageContent(draft as Record<number, unknown>));
      setTitles((draft) => replayInto(draft, ''));
      setDescriptions((draft) => replayInto(draft, ''));
      // Kinds are keyed by page number like titles, so a heading that moves
      // stays a heading — otherwise a renumbering would quietly flatten the
      // directory. Its empty value is the default kind, not a missing key.
      setKinds((draft) => replayInto(draft, DEFAULT_PAGE_KIND));
      // And the carousel lengths, or a moved page would arrive with its screens
      // and no record of having them.
      setSubpageCounts((draft) => replayInto(draft, MIN_SUBPAGE));
    },
    [setPages, setTitles, setKinds, setDescriptions, setSubpageCounts, liveSubpageCounts],
  );

  const reorder = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const response = await fetch('/api/reorder', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          // The live page numbers go with the request: the server cannot see
          // the playhtml document, and planning without them would let a shift
          // overwrite a page nobody published.
          body: JSON.stringify({ ...payload, livePages: occupiedPages }),
        });
        const body = (await response.json()) as { error?: string } & ReorderPlan;
        if (!response.ok) {
          return { ok: false as const, error: body.error ?? `Failed (${response.status}).` };
        }
        replayPlan({ lifts: body.lifts, moves: body.moves, drops: body.drops });
        reloadPublished();
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: 'Could not reach the server.' };
      }
    },
    [replayPlan, reloadPublished, occupiedPages],
  );

  const shiftPages = useCallback<ArchiveAdminApi['shiftPages']>(
    (fromPage, delta) => reorder({ action: 'shift', fromPage, delta }),
    [reorder],
  );

  const moveBlock = useCallback<ArchiveAdminApi['moveBlock']>(
    (blockStart, blockEnd, destination) =>
      reorder({ action: 'move', blockStart, blockEnd, destination }),
    [reorder],
  );

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

  const deletePage = useCallback<ArchiveAdminApi['deletePage']>(
    async (pageNumber) => {
      try {
        // The record goes first. If clearing the live document succeeded and
        // this failed, the page would be gone but still listed as published —
        // whereas a record removed with content still live is visible and
        // fixable from this screen.
        if (publishedByPage.has(pageNumber)) {
          const result = await unpublish(pageNumber);
          if (!result.ok) return result;
        }

        // Every channel keyed by page number, so nothing is left behind to
        // make the page look occupied afterwards — and every screen of the
        // carousel, not only the first, or the rest would still be dialable.
        const keys = pageKeys(pageNumber, subpageCountOf(liveSubpageCounts, pageNumber));
        setPages((draft) => {
          for (const key of keys) draft[key as number] = {};
        });
        clearPageText(pageNumber);
        return { ok: true };
      } catch (error) {
        // Returned rather than thrown: the caller clears its busy flag on a
        // result, and a rejected promise left the whole screen disabled with
        // nothing on it to say why.
        return {
          ok: false,
          error:
            error instanceof Error
              ? `Could not delete page ${pageNumber}: ${error.message}`
              : `Could not delete page ${pageNumber}.`,
        };
      }
    },
    [publishedByPage, unpublish, setPages, clearPageText, liveSubpageCounts],
  );

  return {
    captures,
    total,
    published,
    publishedByPage,
    publicationAt,
    subpageCountOfPage,
    addSubpage: subpages.addSubpage,
    removeLastSubpage,
    menus,
    loading,
    error,
    publishedError,
    pageSize: PAGE_SIZE,
    retryCaptures,
    reloadPublished,
    loadPage,
    livePage,
    transform,
    publish,
    unpublish,
    saveMenu,
    deleteMenu,
    shiftPages,
    moveBlock,
    deletePage,
    titleOf,
    descriptionOf,
    savePageText,
    occupiedPages,
    handMadePages,
  };
}
