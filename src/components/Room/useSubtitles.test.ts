// Feature: the EN key's mode. Verifies: EN shows a translated page in English
// with the lamp lit, stays on across pages, pressed on a page with nothing to
// show flashes red and then switches itself off, and starts on for a visitor
// who chose English — dark, without a flash, where the first page has none.

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLS, ROWS, type Cell, type TeletextPage } from '../../types/teletext';
import { LanguageContext } from './languageContext';
import { EN_FAULT_MS, useSubtitles } from './useSubtitles';

vi.mock('../../features', () => ({ SUB_ENABLED: true }));

function pageSaying(text: string): TeletextPage {
  const page = Array.from({ length: COLS * ROWS }, (): Cell => ({ char: ' ', fg: 'white', bg: 'black' }));
  [...text].forEach((char, i) => (page[2 * COLS + i].char = char));
  return page;
}

const tempo = pageSaying('Tempo');
const runs = [{ row: 2, col: 0, pt: 'Tempo', en: 'Clima' }];

vi.stubGlobal(
  'fetch',
  vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/snapshot?sub=901'
        ? new Response(JSON.stringify({ runs }))
        : new Response('{"error":"No translation."}', { status: 404 }),
    ),
  ),
);

afterEach(() => vi.useRealTimers());

const firstRow = (page: TeletextPage) => page.slice(2 * COLS, 2 * COLS + 5).map((c) => c.char).join('');

describe('useSubtitles', () => {
  it('turns a translated page English, and keeps the mode across pages', async () => {
    const { result, rerender } = renderHook(({ n }) => useSubtitles(n, 1, tempo), {
      initialProps: { n: 901 },
    });
    expect(result.current.lamp).toBe('off');

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.lamp).toBe('live'));
    expect(firstRow(result.current.page)).toBe('Clima');

    rerender({ n: 902 }); // no translation: Portuguese, lamp dark, mode still on
    await waitFor(() => expect(result.current.lamp).toBe('off'));
    expect(firstRow(result.current.page)).toBe('Tempo');
    rerender({ n: 901 });
    await waitFor(() => expect(result.current.lamp).toBe('live'));
  });

  it('answers a press on a page with nothing with a red lamp, then off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useSubtitles(903, 1, tempo));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.lamp).toBe('no-signal'));

    act(() => vi.advanceTimersByTime(EN_FAULT_MS));
    expect(result.current.lamp).toBe('off');
  });

  it('starts on for a visitor who chose English', async () => {
    const english = ({ children }: { children: ReactNode }) =>
      createElement(LanguageContext, { value: 'en' }, children);
    const { result, rerender } = renderHook(({ n }) => useSubtitles(n, 1, tempo), {
      initialProps: { n: 902 },
      wrapper: english,
    });
    await waitFor(() => expect(result.current.lamp).toBe('off')); // nothing here, and no flash
    rerender({ n: 901 });
    await waitFor(() => expect(result.current.lamp).toBe('live'));
    expect(firstRow(result.current.page)).toBe('Clima');
  });
});
