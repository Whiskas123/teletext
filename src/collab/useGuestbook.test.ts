// Feature: the guestbook's binding to `/api/guestbook`. Verifies: the page is
// told the book is unreachable once loading has gone on past `STALL_MS`, the
// book comes from the server, a cache with signatures is never replaced by an
// empty book, signing reports what the server said, and a new signature
// survives a book that predates it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useGuestbook } from './useGuestbook';
import { STALL_MS } from './useConnection';
import { createEmptySnippet } from '../domain/guestbook';

const CACHE_KEY = 'teletext.guestbook.entries';

function inkedSnippet() {
  const cells = createEmptySnippet();
  cells[0] = { char: 'A', fg: 'white', bg: 'black', graphics: null };
  return cells;
}

const entry = (id: string, ts: number) => ({ id, name: 'Ana', authorId: 'x', ts, cells: { 0: inkedSnippet()[0] } });

const answer = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('useGuestbook', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is loading, then unreachable once the wait is over', () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => useGuestbook());
    expect(result.current.loading).toBe(true);
    expect(result.current.unreachable).toBe(false);

    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(result.current.unreachable).toBe(true);
  });

  it('shows the book the server holds, newest first', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer(200, { entries: [entry('a', 1), entry('b', 2)] })));
    const { result } = renderHook(() => useGuestbook());
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(['b', 'a']));
    expect(result.current.loading).toBe(false);
    expect(result.current.unreachable).toBe(false);
  });

  it('keeps a cache with signatures when the book is empty', async () => {
    const cached = JSON.stringify([{ ...entry('old', 1), cells: inkedSnippet() }]);
    localStorage.setItem(CACHE_KEY, cached);
    vi.stubGlobal('fetch', vi.fn(() => answer(200, { entries: [] })));

    const { result } = renderHook(() => useGuestbook());
    await waitFor(() => expect(result.current.entries).toEqual([]));
    expect(localStorage.getItem(CACHE_KEY)).toBe(cached);
  });

  it('signs through the server and shows the signature at once', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? answer(201, { entry: entry('new', 5) }) : answer(200, { entries: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGuestbook());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sign('Ana', inkedSnippet());
    });
    expect(outcome).toEqual({ ok: true, name: 'Ana' });
    expect(result.current.entries.map((e) => e.id)).toEqual(['new']);
  });

  it('keeps a new signature when a stale book arrives after it', async () => {
    // The first load is still in flight when the reader signs, and answers
    // with the book from before — as an edge-cached book does.
    let answerStale: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? answer(201, { entry: entry('new', 5) })
          : new Promise<Response>((resolve) => (answerStale = resolve)),
      ),
    );
    const { result } = renderHook(() => useGuestbook());

    await act(async () => {
      await result.current.sign('Ana', inkedSnippet());
    });
    await act(async () => answerStale(new Response(JSON.stringify({ entries: [entry('old', 1)] }))));
    expect(result.current.entries.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('says why a signature did not land', async () => {
    let status = 429;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? answer(status, {}) : answer(200, { entries: [] }),
      ),
    );
    const { result } = renderHook(() => useGuestbook());

    await expect(result.current.sign('Ana', inkedSnippet())).resolves.toEqual({ ok: false, reason: 'too-soon' });
    status = 500;
    await expect(result.current.sign('Ana', inkedSnippet())).resolves.toEqual({ ok: false, reason: 'offline' });
    // Refused before anything is sent, by the same rules the server applies.
    await expect(result.current.sign('', inkedSnippet())).resolves.toEqual({ ok: false, reason: 'no-name' });
  });
});
