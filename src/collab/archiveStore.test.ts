// Feature: the curated archive, edited in the browser and saved to the
// database. Verifies: nothing is written before a fresh read of the database
// lands (so a cached copy is never saved over the real one), and a write is
// sent to the store each page belongs to. And a save made from a copy another
// tab has since changed is refused and not retried (2026-11-14).

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@playhtml/react', () => ({
  usePageData: () => [{}, vi.fn()],
  usePlayContext: () => ({ isLoading: false, isProviderMissing: false }),
}));

const BOOT = {
  pages: { 100: { 0: { char: 'A', fg: 'white', bg: 'black', graphics: null } } },
  'subpage-counts': {},
  titles: { 100: 'Index', 720: 'Visitor' },
  'page-kinds': {},
};

describe('the archive store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('index=1')
          ? new Response(JSON.stringify({ rows: [] }), { status: 200 })
          : new Response(JSON.stringify(BOOT), { status: 200 }),
      ),
    );
  });

  it('refuses to write until the archive has been read fresh', async () => {
    const store = await import('./archiveStore');
    const setLive = vi.fn();

    expect(store.writeEntries('titles', { 100: 'New' }, setLive)).toBe(false);
    expect(setLive).not.toHaveBeenCalled();

    expect(await store.loadArchiveFresh()).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('fresh=1'), expect.anything());
    expect(store.writeEntries('titles', { 100: 'New' }, setLive)).toBe(true);
  });

  it('sends archive pages to the database and the rest to playhtml', async () => {
    const store = await import('./archiveStore');
    await store.loadArchiveFresh();
    const draft: Record<string, unknown> = {};
    const setLive = vi.fn((recipe: (d: Record<string, unknown>) => void) => recipe(draft));

    store.writeEntries('titles', { 100: 'Front', 720: 'Mine' }, setLive);

    expect(draft).toEqual({ 720: 'Mine' });
    // The archive half is held here (and saved by the mirror engine), not sent
    // to playhtml; playground keys from the boot file are not kept in it.
    const { result } = renderHook(() => store.useArchiveChannel('titles'));
    expect(result.current).toEqual({ 100: 'Front' });
  });

  it('a tab whose copy is out of date is refused, says which page, and stops saving', async () => {
    vi.useFakeTimers();
    const posts: Record<string, unknown>[] = [];
    let indexReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('index=1')) {
          indexReads += 1;
          // What this tab saw when it loaded: page 100 as fingerprint "seen".
          return new Response(JSON.stringify({ rows: [[100, 1, 'seen']] }), { status: 200 });
        }
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          // Another tab has saved page 100 since.
          return new Response(JSON.stringify({ stale: ['100.1'] }), { status: 409 });
        }
        return new Response(JSON.stringify(BOOT), { status: 200 });
      }),
    );
    const store = await import('./archiveStore');
    await store.loadArchiveFresh();
    const { result } = renderHook(() => store.useArchiveStatus());

    store.writeEntries('titles', { 100: 'From the old tab' }, vi.fn());
    await vi.advanceTimersByTimeAsync(4_000);

    expect(posts).toHaveLength(1);
    expect(posts[0].expect).toEqual({ '100.1': 'seen' });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/page 100 was changed in another tab.*Reload/);

    // Nothing is retried or re-read: a fresh list would make the old copy look current.
    store.writeEntries('titles', { 100: 'Again' }, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts).toHaveLength(1);
    expect(indexReads).toBe(1);
    vi.useRealTimers();
  });
});
