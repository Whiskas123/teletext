// Renumbering many pages at once reaches the live document in writes small
// enough for playhtml's server to accept. It used to be one transaction: closing
// the gap in front of 44 pages was a 4.9 MB message, and never arrived.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { MAX_WRITE_JSON } from '../domain/liveWrites';

/** The live channels, and the size of every transaction written to them. */
const channels: Record<string, Record<string, unknown>> = {};
const writes: { channel: string; json: number }[] = [];

vi.mock('@playhtml/react', async () => {
  const { useState } = await import('react');
  return {
    usePlayContext: () => ({ isLoading: false }),
    usePageData: (channel: string, fallback: Record<string, unknown>) => {
      const [, rerender] = useState(0);
      channels[channel] ??= { ...fallback };
      const set = (change: (draft: Record<string, unknown>) => void) => {
        // What the transaction sends: the keys it assigned, with their values.
        const before = JSON.stringify(channels[channel]);
        const draft = new Proxy(channels[channel], {
          set(target, key, value) {
            sent[String(key)] = value;
            target[String(key)] = value;
            return true;
          },
        });
        const sent: Record<string, unknown> = {};
        change(draft);
        if (JSON.stringify(channels[channel]) !== before || Object.keys(sent).length > 0) {
          writes.push({ channel, json: JSON.stringify(sent).length });
        }
        channels[channel] = { ...channels[channel] };
        rerender((n) => n + 1);
      };
      return [channels[channel], set];
    },
  };
});

const { useArchiveAdmin } = await import('./useArchiveAdmin');

const screen = (char: string) =>
  Object.fromEntries(Array.from({ length: 960 }, (_, index) => [index, { char, fg: 'white', bg: 'black' }]));

beforeEach(() => {
  writes.length = 0;
  for (const key of Object.keys(channels)) delete channels[key];
  // 100, a gap at 101, then 44 pages — the second with a three-screen carousel.
  channels.pages = { 100: screen('I') };
  channels.titles = { 100: 'Index' };
  channels['subpage-counts'] = { 103: 3 };
  for (let page = 102; page < 146; page += 1) {
    channels.pages[page] = screen(String.fromCharCode(0x30 + (page % 40)));
    channels.titles[page] = `Page ${page}`;
  }
  channels.pages['103.2'] = screen('2');
  channels.pages['103.3'] = screen('3');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ published: [], menus: [], rows: [] }), { status: 200 })),
  );
});

it('closes a gap in front of 44 pages in writes that each fit, ending where one write would have', async () => {
  const { result } = renderHook(() =>
    useArchiveAdmin({ admin: true, archiveEnabled: false, filters: {} as never, offset: 0 }),
  );
  const expected = Object.fromEntries(
    Array.from({ length: 44 }, (_, index) => [101 + index, channels.pages[102 + index]]),
  );

  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.arrange(
      Array.from({ length: 44 }, (_, index) => ({ from: 102 + index, to: 101 + index })),
    );
  });

  expect(outcome).toEqual({ ok: true });
  for (const [page, cells] of Object.entries(expected)) expect(channels.pages[page]).toEqual(cells);
  expect(channels.pages['102.2']).toEqual(screen('2'));
  expect(channels.pages['102.3']).toEqual(screen('3'));
  expect(channels.pages[145]).toEqual({});
  expect(channels.pages['103.3']).toEqual({});
  expect(channels.titles[101]).toBe('Page 102');
  expect(channels['subpage-counts'][102]).toBe(3);

  const pageWrites = writes.filter(({ channel }) => channel === 'pages');
  expect(pageWrites.length).toBeGreaterThan(5);
  for (const { json } of pageWrites) expect(json).toBeLessThanOrEqual(MAX_WRITE_JSON + 70_000);
});
