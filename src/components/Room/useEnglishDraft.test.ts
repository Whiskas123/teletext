// Feature: the editor's English mode. Verifies: a screen with a translation
// opens in English; only letters inside translated lines can change; a moment
// after typing stops the English is saved, with lines still in Portuguese left
// out; and a screen with no translation has nothing to edit.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLS, ROWS, type Cell, type TeletextPage } from '../../types/teletext';
import { useEnglishDraft } from './useEnglishDraft';

function pageSaying(lines: Record<number, string>): TeletextPage {
  const page = Array.from({ length: COLS * ROWS }, (): Cell => ({ char: ' ', fg: 'white', bg: 'black' }));
  for (const [row, text] of Object.entries(lines)) {
    [...text].forEach((char, i) => (page[Number(row) * COLS + i].char = char));
  }
  return page;
}

const portuguese = pageSaying({ 2: 'Tempo', 3: 'Desporto' });
const rowText = (page: TeletextPage | null, row: number) =>
  page?.slice(row * COLS, row * COLS + 8).map((c) => c.char).join('').trim();

function serve() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { runs } = JSON.parse(String(init.body)) as { runs: { row: number; col: number; en: string }[] };
      return new Response(JSON.stringify({ key: '104', runs: runs.map((r) => ({ ...r, pt: 'Tempo' })) }));
    }
    return new Response(
      JSON.stringify({ translations: { 104: [{ row: 2, col: 0, pt: 'Tempo', en: 'Clima' }] } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useEnglishDraft', () => {
  it('edits only the words of translated lines, and saves them after a pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = serve();
    const { result } = renderHook(() => useEnglishDraft(104, 1, portuguese, true));
    await waitFor(() => expect(rowText(result.current.page, 2)).toBe('Clima'));
    expect(rowText(result.current.page, 3)).toBe('Desporto'); // not translated

    const cell = (char: string): Cell => ({ char, fg: 'red', bg: 'blue', graphics: 7 });
    let refused = true;
    act(() => {
      refused = !result.current.editCell(10 * COLS, cell('X')); // no text there
    });
    expect(refused).toBe(true);
    act(() => {
      result.current.editCell(2 * COLS, cell('K'));
    });
    expect(rowText(result.current.page, 2)).toBe('Klima');
    // The letter, not the brush: colours and graphics stay the line's own.
    expect(result.current.page![2 * COLS]).toMatchObject({ fg: 'white', bg: 'black' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/snapshot?sub=104');
    // Desporto is still Portuguese and had no English: left out.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ runs: [{ row: 2, col: 0, en: 'Klima' }] });
  });

  it('has nothing to edit on a screen with no translation', async () => {
    serve();
    const { result } = renderHook(() => useEnglishDraft(105, 1, portuguese, true));
    await act(async () => {});
    expect(result.current.page).toBeNull();
    expect(result.current.editCell(2 * COLS, { char: 'K', fg: 'white', bg: 'black' })).toBe(false);
  });
});
