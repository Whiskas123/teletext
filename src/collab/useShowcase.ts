/**
 * The strip on the front page: what is on it, and putting things on it.
 *
 * Two halves, and only moderators see the second.
 *
 * Reading is public and cheap — `/api/showcase` returns the running order and
 * no bytes, and the pictures are fetched by URL so the browser caches them
 * separately from the list.
 *
 * Writing is the interesting half. A page's cells live in playhtml, which only
 * a connected browser can read, so the picture cannot be made on the server:
 * the moderator's browser draws it and uploads it. That is the same split as
 * publishing (`api/published.ts`), and it is what makes the front page free —
 * the drawing happens once, when a page is chosen, rather than in every
 * visitor's browser on every visit.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { normalizePage } from '../domain/pageOps';
import {
  SHOWCASE_BOOT_ID,
  showcaseVersionKey,
  type ShowcaseBootEntry,
} from '../domain/showcase';
import { pageKey, type SubpageCounts, SUBPAGE_COUNTS_CHANNEL } from '../domain/subpages';
import { blobToBase64, renderPageBlob } from '../utils/pageCanvas';
import { PAGES_CHANNEL } from './useEditPage';
import { usePageTitles } from './useGuide';
import type { PagesData } from './types';

/** One page on the strip, as the endpoint reports it. */
export interface ShowcaseEntry {
  page_number: number;
  subpage: number;
  position: number;
  title: string;
  updated_at: string;
}

/**
 * Where a page's stored picture lives.
 *
 * `version` is the row's `updated_at`, and it is what makes Redraw visible. The
 * picture for a page always lived at the same URL, so redrawing it changed the
 * bytes on the server and nothing on screen — the browser went on serving the
 * copy it had cached. Putting the timestamp in the URL means a redrawn page is
 * a *different* URL, so it is fetched, and an unchanged one can be cached hard.
 */
export function showcaseImageUrl(
  pageNumber: number,
  subpage: number,
  version?: string,
): string {
  const base = `/api/showcase?format=image&page=${pageNumber}&subpage=${subpage}`;
  return version == null ? base : `${base}&v=${encodeURIComponent(version)}`;
}

/**
 * What the build baked into this page's HTML, read once.
 *
 * `scripts/prerender.ts` writes the strip into a `<script type="application/json">`
 * on the two landing addresses, next to a `<link rel="preload">` per picture.
 * Reading it here means the hook's *first* render already has the strip — no
 * empty frame, and no waiting on `/api/showcase` before the `<img>`s exist for
 * the browser to fetch. See the note in `src/domain/showcase.ts`.
 *
 * Read at module scope rather than in the hook: the block is written once by
 * the build and never changes, so parsing it per mount would be work repeated
 * for an answer that cannot have moved.
 *
 * Anything unexpected — no block, malformed JSON, a build that could not reach
 * the database — leaves this empty, and the hook behaves exactly as it did
 * before: it asks the endpoint and fills in when the answer arrives.
 */
function readBoot(): ShowcaseBootEntry[] {
  try {
    const block = globalThis.document?.getElementById(SHOWCASE_BOOT_ID);
    if (block?.textContent == null) return [];
    const parsed: unknown = JSON.parse(block.textContent);
    return Array.isArray(parsed) ? (parsed as ShowcaseBootEntry[]) : [];
  } catch {
    return [];
  }
}

const BOOT = readBoot();

/** The build's picture for each page *at the version the build saw*. */
const BOOT_PICTURES = new Map(
  BOOT.map((entry) => [
    showcaseVersionKey(entry.page_number, entry.subpage, entry.updated_at),
    entry.src,
  ]),
);

/**
 * Where the front page should fetch a page's picture.
 *
 * The build's own file when it has one for this exact version — a static file
 * on the CDN, already preloaded and already in cache — and the endpoint for
 * anything else: a page put on the strip, or redrawn, since the last deploy.
 * Those arrive a moment later and are baked in at the next build.
 *
 * `/manage` deliberately does *not* use this (see `ShowcasePanel`): a moderator
 * pressing Redraw has to see the new drawing, not the one the build kept.
 */
export function showcasePictureUrl(
  pageNumber: number,
  subpage: number,
  version?: string,
): string {
  const baked =
    version == null
      ? undefined
      : BOOT_PICTURES.get(showcaseVersionKey(pageNumber, subpage, version));
  return baked ?? showcaseImageUrl(pageNumber, subpage, version);
}

export interface ShowcaseApi {
  entries: ShowcaseEntry[];
  loading: boolean;
  error: string | null;
  reload(): void;
  /** Whether this screen is already on the strip. */
  has(pageNumber: number, subpage: number): boolean;
  /**
   * Draw this screen as it stands and put it on the strip, replacing any
   * picture already stored for it.
   */
  add(
    pageNumber: number,
    subpage?: number,
    position?: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Take a screen off the strip. */
  remove(
    pageNumber: number,
    subpage?: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface ShowcaseOptions {
  /**
   * Always read past the edge cache.
   *
   * `/api/showcase` is held at the edge for a few minutes (see the note in
   * `api/showcase.ts`), which is what a visitor wants and what a moderator
   * cannot have: someone who just put a page on the strip and reloaded
   * `/manage` would be shown the list as it was before they touched it, with
   * nothing to say why. So the screen that *edits* the strip always asks the
   * database, and the screen that only shows it takes the cached answer.
   */
  fresh?: boolean;
}

export function useShowcase({ fresh = false }: ShowcaseOptions = {}): ShowcaseApi {
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [counts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  const { title } = usePageTitles();

  // Seeded from the build, so the strip is on screen in the first frame rather
  // than after a round trip. The fetch below still runs and still wins — this
  // is a head start, not a cache.
  const [entries, setEntries] = useState<ShowcaseEntry[]>(BOOT);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which fetch is wanted, and which has answered.
   *
   * `loading` is derived from the two rather than being its own flag set at the
   * top of the fetch: setting state synchronously inside an effect costs a
   * second render pass before the browser paints, for something already
   * knowable. The same shape `useArchiveAdmin` uses for its capture query.
   */
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState(-1);
  const loading = settled !== attempt;

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    // A parameter the endpoint ignores, which is enough to read past the edge:
    // it is a different cache key, so the edge fetches rather than answering
    // from what it has. Used for `fresh` callers, and for every `reload()` —
    // which is only ever called after this browser added or removed a page, and
    // has to see its own change.
    const url =
      fresh || attempt > 0 ? `/api/showcase?fresh=${Date.now()}` : '/api/showcase';

    fetch(url, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed (${response.status}).`);
        const body = (await response.json()) as { showcase?: ShowcaseEntry[] };
        if (cancelled) return;
        setEntries(body.showcase ?? []);
        setError(null);
      })
      .catch((cause: unknown) => {
        // The last good list is kept: an empty strip and a failed request are
        // not the same thing, and the front page would rather show what it had.
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the showcase.');
      })
      .finally(() => {
        if (!cancelled) setSettled(attempt);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, fresh]);

  const has = useCallback(
    (pageNumber: number, subpage: number) =>
      entries.some((e) => e.page_number === pageNumber && e.subpage === subpage),
    [entries],
  );

  const add = useCallback<ShowcaseApi['add']>(
    async (pageNumber, subpage = 1, position = 0) => {
      const stored = (pages as Record<string, unknown> | null)?.[
        String(pageKey(pageNumber, subpage))
      ];
      const page = normalizePage(stored);

      const subpageCount = Math.max(1, Number(counts?.[pageNumber] ?? 1));
      const blob = await renderPageBlob(page, {
        pageNumber,
        subpage,
        subpageCount,
        // The fastext strip is identical on every page; a row of them along the
        // front page would be a repeated smear.
        showIndexLine: false,
        // And so is the header row — page number, counter, and a clock frozen
        // at the moment this was drawn.
        skipHeaderRow: true,
      });
      if (blob == null) {
        return { ok: false, error: 'This browser could not draw the page.' };
      }

      try {
        const response = await fetch('/api/showcase', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageNumber,
            subpage,
            position,
            title: title(pageNumber),
            imageType: blob.type || 'image/png',
            image: await blobToBase64(blob),
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `Failed (${response.status}).` };
        }
        reload();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [pages, counts, title, reload],
  );

  const remove = useCallback<ShowcaseApi['remove']>(
    async (pageNumber, subpage = 1) => {
      try {
        const response = await fetch(
          `/api/showcase?page=${pageNumber}&subpage=${subpage}`,
          { method: 'DELETE', credentials: 'same-origin' },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `Failed (${response.status}).` };
        }
        reload();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [reload],
  );

  return { entries, loading, error, reload, has, add, remove };
}
