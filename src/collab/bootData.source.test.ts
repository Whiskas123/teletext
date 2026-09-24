/**
 * Where the fallback pages come from: the database's live copy first, which is
 * minutes old at most, and the build's file only when that fails.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { BOOT_DATA_PATH, BOOT_LIVE_PATH } from '../domain/bootData';

vi.mock('@playhtml/react', () => ({
  usePlayContext: () => ({ isLoading: true }),
  usePageData: (_channel: string, fallback: unknown) => [fallback, vi.fn()],
}));

const boot = (title: string) => ({
  pages: {},
  'subpage-counts': {},
  titles: { 100: title },
  'page-kinds': {},
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('uses the live copy when it answers, without fetching the build’s file', async () => {
  const fetchSpy = vi.fn(async (path: string) =>
    path === BOOT_LIVE_PATH
      ? { ok: true, json: async () => boot('Live copy') }
      : { ok: true, json: async () => boot('Build file') },
  );
  vi.stubGlobal('fetch', fetchSpy);
  const { usePageDataWithBoot } = await import('./bootData');

  const { result } = renderHook(() => usePageDataWithBoot('titles', {}));
  await waitFor(() => expect(result.current[0]).toEqual({ 100: 'Live copy' }));
  expect(fetchSpy.mock.calls.map(([path]) => path)).toEqual([BOOT_LIVE_PATH]);
});

it('falls back to the build’s file when the live copy is not there', async () => {
  // A local dev server has no API and answers with its HTML page instead.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path === BOOT_LIVE_PATH
        ? { ok: true, json: async () => JSON.parse('<!doctype html>') }
        : { ok: true, json: async () => boot('Build file') },
    ),
  );
  const { usePageDataWithBoot } = await import('./bootData');

  const { result } = renderHook(() => usePageDataWithBoot('titles', {}));
  await waitFor(() => expect(result.current[0]).toEqual({ 100: 'Build file' }));
  expect(BOOT_DATA_PATH).toBe('/boot/pages.json');
});
