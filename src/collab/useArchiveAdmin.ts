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

import { useCallback, useEffect, useState } from 'react';

import { pageToArray } from '../domain/pageEncoding';
import { useGuide } from './useGuide';
import { useImportPages } from './useImportPages';
import type { TeletextPage } from './types';

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
  loading: boolean;
  error: string | null;
  /** Re-run the capture query with new filters. */
  search(filters: CaptureFilters, offset?: number): void;
  /** Fetch one capture's cells, for previewing. */
  loadPage(captureId: number): Promise<TeletextPage | null>;
  /** Record the assignment, then write the cells into playhtml. */
  publish(input: {
    pageNumber: number;
    captureId: number;
    title: string;
    description: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Clear the record and blank the page in playhtml. */
  unpublish(pageNumber: number): Promise<{ ok: true } | { ok: false; error: string }>;
}

const PAGE_SIZE = 60;

export function useArchiveAdmin(): ArchiveAdminApi {
  const { importPages } = useImportPages();
  const { setTitle } = useGuide();

  const [published, setPublished] = useState<PublishedEntry[]>([]);
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

  const search = useCallback((filters: CaptureFilters, offset = 0) => {
    setQuery({ filters, offset });
  }, []);

  const loadPage = useCallback(async (captureId: number): Promise<TeletextPage | null> => {
    try {
      const body = await getJson<{ cells: unknown }>(`/api/captures/${captureId}`);
      return body.cells == null ? null : pageToArray(body.cells);
    } catch {
      return null;
    }
  }, []);

  const publish = useCallback<ArchiveAdminApi['publish']>(
    async ({ pageNumber, captureId, title, description }) => {
      try {
        const response = await fetch('/api/published', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageNumber, captureId, title, description }),
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

  return {
    captures,
    total,
    published,
    loading,
    error,
    search,
    loadPage,
    publish,
    unpublish,
  };
}
