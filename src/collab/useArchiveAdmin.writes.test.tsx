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
  // 700, a gap at 701, then 44 pages — the second with a three-screen carousel.
  channels.pages = { 700: screen('I') };
  channels.titles = { 700: 'Index' };
  channels['subpage-counts'] = { 703: 3 };
  for (let page = 702; page < 746; page += 1) {
    channels.pages[page] = screen(String.fromCharCode(0x30 + (page % 40)));
    channels.titles[page] = `Page ${page}`;
  }
  channels.pages['703.2'] = screen('2');
  channels.pages['703.3'] = screen('3');
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
    Array.from({ length: 44 }, (_, index) => [701 + index, channels.pages[702 + index]]),
  );

  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.arrange(
      Array.from({ length: 44 }, (_, index) => ({ from: 702 + index, to: 701 + index })),
    );
  });

  expect(outcome).toEqual({ ok: true });
  for (const [page, cells] of Object.entries(expected)) expect(channels.pages[page]).toEqual(cells);
  expect(channels.pages['702.2']).toEqual(screen('2'));
  expect(channels.pages['702.3']).toEqual(screen('3'));
  expect(channels.pages[745]).toEqual({});
  expect(channels.pages['703.3']).toEqual({});
  expect(channels.titles[701]).toBe('Page 702');
  expect(channels['subpage-counts'][702]).toBe(3);

  const pageWrites = writes.filter(({ channel }) => channel === 'pages');
  expect(pageWrites.length).toBeGreaterThan(5);
  for (const { json } of pageWrites) expect(json).toBeLessThanOrEqual(MAX_WRITE_JSON + 70_000);
});

it('merges several pages into one, each after the last, not all onto the same screen', async () => {
  // 703 has three screens; 702 and 704 one each.
  const { result } = renderHook(() =>
    useArchiveAdmin({ admin: true, archiveEnabled: false, filters: {} as never, offset: 0 }),
  );
  const [p702, p704] = [channels.pages[702], channels.pages[704]];

  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.absorbPages(700, [702, 703, 704]);
  });

  expect(outcome).toEqual({ ok: true });
  expect(channels.pages['700.2']).toEqual(p702);
  expect(channels.pages['700.4']).toEqual(screen('2'));
  expect(channels.pages['700.5']).toEqual(screen('3'));
  expect(channels.pages['700.6']).toEqual(p704);
  expect(channels['subpage-counts'][700]).toBe(6);
  for (const key of ['702', '703', '703.2', '703.3', '704']) expect(channels.pages[key]).toEqual({});
  expect(channels.titles[700]).toBe('Index');
});

it('moves a screen within its page, with its source, and shifts the ones between', async () => {
  channels['page-sources'] = { 703: { captureId: 1 }, '703.3': { captureId: 3 } };
  const { result } = renderHook(() =>
    useArchiveAdmin({ admin: true, archiveEnabled: false, filters: {} as never, offset: 0 }),
  );
  const first = channels.pages[703];

  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.moveScreen(703, 3, 1);
  });

  expect(outcome).toEqual({ ok: true });
  expect(channels.pages[703]).toEqual(screen('3'));
  expect(channels.pages['703.2']).toEqual(first);
  expect(channels.pages['703.3']).toEqual(screen('2'));
  expect(channels['page-sources'][703]).toEqual({ captureId: 3 });
  expect(channels['page-sources']['703.2']).toEqual({ captureId: 1 });
  expect(channels['page-sources']['703.3']).toEqual({});
  expect(channels['subpage-counts'][703]).toBe(3);

  await act(async () => {
    outcome = await result.current.moveScreen(703, 1, 4);
  });
  expect(outcome).toEqual({ ok: false, error: 'Page 703 has screens 1–3.' });
});
