// The live mirror in a moderator's browser: it waits for playhtml to sync,
// sends what changed once edits settle, deletes what left the service, holds
// back deletions that look like a broken document, and never runs on an
// address other than the live site's.

import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPage } from '../types/teletext';

// jsdom is on `localhost`; say the live site is too, so the mirror runs here.
vi.mock('../domain/seo', () => ({ SITE_URL: 'http://localhost' }));

const channels: Record<string, Record<string, unknown>> = {};
let isLoading = false;
vi.mock('@playhtml/react', () => ({
  usePlayContext: () => ({ isLoading }),
  usePageData: (channel: string) => [channels[channel] ?? {}, vi.fn()],
}));

const { LiveMirror, useMirrorStatus } = await import('./liveMirror');

function drawn(char: string) {
  const page = createEmptyPage();
  page[0] = { ...page[0], char };
  return Object.fromEntries(page.map((cell, index) => [index, cell]));
}

let copyRows: [number, number, string | null][] = [];
let posts: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  isLoading = false;
  copyRows = [];
  posts = [];
  for (const key of Object.keys(channels)) delete channels[key];
  channels.pages = { 100: drawn('A'), 101: drawn('B') };
  channels.titles = { 100: 'Index' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('index')) {
        return new Response(JSON.stringify({ rows: copyRows }), { status: 200 });
      }
      posts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let status: ReturnType<typeof useMirrorStatus>;
function Harness() {
  const current = useMirrorStatus();
  useEffect(() => {
    status = current;
  });
  return <LiveMirror />;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_500);
  });
}

describe('the live mirror', () => {
  it('sends every screen the copy lacks, with its fingerprint, once edits settle', async () => {
    render(<Harness />);
    expect(posts).toHaveLength(0);
    await settle();

    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0].pages as object).sort()).toEqual(['100', '101']);
    expect(Object.keys(posts[0].digests as object).sort()).toEqual(['100', '101']);
    expect(status.phase).toBe('synced');
  });

  it('sends nothing when the copy already matches', async () => {
    const { unmount } = render(<Harness />);
    await settle();
    const digests = posts[0].digests as Record<string, string>;
    unmount();

    copyRows = [
      [100, 1, digests['100']],
      [101, 1, digests['101']],
    ];
    posts = [];
    render(<Harness />);
    await settle();
    expect(posts).toHaveLength(0);
    expect(status.phase).toBe('synced');
  });

  it('deletes a page that left the service', async () => {
    copyRows = [[102, 1, 'old']];
    render(<Harness />);
    await settle();
    expect(posts.at(-1)?.removed).toEqual([102]);
  });

  it('holds back deletions that look like a broken document', async () => {
    copyRows = Array.from({ length: 25 }, (_, i) => [300 + i, 1, 'old'] as [number, number, string]);
    render(<Harness />);
    await settle();
    expect(posts.flatMap((post) => (post.removed as number[]) ?? [])).toEqual([]);
    expect(status.held).toHaveLength(25);

    // A person confirms; now they go.
    await act(async () => {
      status.confirmHeld();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(posts.at(-1)?.removed).toHaveLength(25);
    expect(status.held).toEqual([]);
  });

  it('does nothing until playhtml has synced — an empty document is not a deleted one', async () => {
    isLoading = true;
    copyRows = [[100, 1, 'x']];
    render(<Harness />);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(status.phase).toBe('waiting');
  });
});
