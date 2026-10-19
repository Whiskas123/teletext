// Feature: the guestbook's binding to the shared document, while it is not
// there. Verifies: the page is told the book is unreachable once syncing has
// gone on past `STALL_MS`, and a signature made before the sync is refused
// rather than handed to playhtml, which would drop it without saying so.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useGuestbook } from './useGuestbook';
import { STALL_MS } from './useConnection';
import { createEmptySnippet } from '../domain/guestbook';

let isLoading = true;
const setData = vi.fn();

vi.mock('@playhtml/react', () => ({
  usePageData: (_channel: string, fallback: unknown) => [fallback, setData],
  usePlayContext: () => ({ isLoading, isProviderMissing: false }),
}));

function inkedSnippet() {
  const cells = createEmptySnippet();
  cells[0] = { char: 'A', fg: 'white', bg: 'black', graphics: null };
  return cells;
}

describe('useGuestbook before the book has synced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isLoading = true;
    setData.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is loading, then unreachable once the wait is over', () => {
    const { result } = renderHook(() => useGuestbook());
    expect(result.current.loading).toBe(true);
    expect(result.current.unreachable).toBe(false);

    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(result.current.unreachable).toBe(true);
  });

  it('stops being unreachable the moment the book arrives', () => {
    const { result, rerender } = renderHook(() => useGuestbook());
    act(() => vi.advanceTimersByTime(STALL_MS));

    isLoading = false;
    rerender();
    expect(result.current.unreachable).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('refuses to sign rather than letting playhtml drop the write', () => {
    const { result } = renderHook(() => useGuestbook());

    expect(result.current.sign('Ana', inkedSnippet())).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(setData).not.toHaveBeenCalled();
  });

  it('signs once synced', () => {
    isLoading = false;
    const { result } = renderHook(() => useGuestbook());

    expect(result.current.sign('Ana', inkedSnippet())).toEqual({ ok: true, name: 'Ana' });
    expect(setData).toHaveBeenCalledTimes(1);
  });
});
