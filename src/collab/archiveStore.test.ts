// Feature: the curated archive, edited in the browser and saved to the
// database. Verifies: nothing is written before a fresh read of the database
// lands (so a cached copy is never saved over the real one), and a write is
// sent to the store each page belongs to.

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
      vi.fn(async () => new Response(JSON.stringify(BOOT), { status: 200 })),
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
});
