/**
 * The build's copy of the pages stands in until the first sync, and not after.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootPage, parseBootData } from '../domain/bootData';
import { createEmptyPage } from '../types/teletext';

/** What the mocked playhtml reports: synced or not, and the live channels. */
const doc = { isLoading: true, channels: {} as Record<string, unknown> };

vi.mock('@playhtml/react', () => ({
  usePlayContext: () => ({ isLoading: doc.isLoading }),
  usePageData: (channel: string, fallback: unknown) => [
    doc.isLoading ? fallback : (doc.channels[channel] ?? fallback),
    vi.fn(),
  ],
}));

const BOOT = {
  pages: { 100: { 0: { char: 'B', fg: 'white', bg: 'black' } } },
  'subpage-counts': { 100: 2 },
  titles: { 100: 'Boot' },
  'page-kinds': {},
};

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => BOOT })),
);

const { usePageDataWithBoot } = await import('./bootData');

afterEach(() => {
  doc.isLoading = true;
  doc.channels = {};
});

describe('usePageDataWithBoot', () => {
  it('shows the build’s copy while playhtml has not synced', async () => {
    const { result } = renderHook(() => usePageDataWithBoot('titles', {}));
    await waitFor(() => expect(result.current[0]).toEqual({ 100: 'Boot' }));
  });

  it('hands over to the live channel once it has synced', async () => {
    const { result, rerender } = renderHook(() => usePageDataWithBoot('titles', {}));
    await waitFor(() => expect(result.current[0]).toEqual({ 100: 'Boot' }));

    doc.isLoading = false;
    doc.channels = { titles: { 100: 'Live' } };
    act(() => rerender());

    expect(result.current[0]).toEqual({ 100: 'Live' });
  });

  it('never uses the copy on a screen that mounts after the sync', () => {
    doc.isLoading = false;
    doc.channels = { titles: {} };
    const { result } = renderHook(() => usePageDataWithBoot('titles', {}));
    expect(result.current[0]).toEqual({});
  });
});

describe('the file', () => {
  it('leaves the empty cells out of a page, and only those', () => {
    const page = createEmptyPage();
    page[5] = { char: 'X', fg: 'red', bg: 'black', graphics: null };
    expect(bootPage(page)).toEqual({ 5: page[5] });
  });

  it('refuses anything that is not the four channels', () => {
    expect(parseBootData(BOOT)).toEqual(BOOT);
    expect(parseBootData({ pages: {} })).toBeNull();
    expect(parseBootData(null)).toBeNull();
  });
});
