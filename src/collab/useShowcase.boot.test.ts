/**
 * Where the front page fetches a picture from.
 *
 * The build writes each chosen page's picture into `dist/showcase/` and lists
 * them in the landing page's HTML, so the browser can start fetching them
 * before the bundle has booted (see `src/domain/showcase.ts`). That leaves one
 * decision to get right, and it is the kind that fails quietly: the build's
 * picture is a snapshot of one *version* of a page, so a page redrawn since the
 * deploy must fall back to the endpoint. Get it wrong and the front page shows
 * a drawing that is weeks out of date, while every test and every type still
 * passes — nobody would find it except by recognising the old page.
 *
 * The module reads the block once, at import, so each case imports it afresh
 * against a DOM prepared beforehand.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHOWCASE_BOOT_ID, type ShowcaseBootEntry } from '../domain/showcase';

const BAKED: ShowcaseBootEntry = {
  page_number: 101,
  subpage: 1,
  position: 0,
  title: 'Arquivo RTP',
  updated_at: '2026-08-16T15:28:48.638Z',
  src: '/showcase/101-1-20260816152848638.png',
};

async function loadWith(entries: unknown): Promise<typeof import('./useShowcase')> {
  document.getElementById(SHOWCASE_BOOT_ID)?.remove();
  if (entries !== undefined) {
    const block = document.createElement('script');
    block.type = 'application/json';
    block.id = SHOWCASE_BOOT_ID;
    block.textContent =
      typeof entries === 'string' ? entries : JSON.stringify(entries);
    document.head.append(block);
  }
  vi.resetModules();
  return import('./useShowcase');
}

afterEach(() => {
  document.getElementById(SHOWCASE_BOOT_ID)?.remove();
});

describe('showcasePictureUrl', () => {
  it('uses the file the build wrote, for the version the build saw', async () => {
    const { showcasePictureUrl } = await loadWith([BAKED]);

    expect(showcasePictureUrl(101, 1, BAKED.updated_at)).toBe(BAKED.src);
  });

  it('falls back to the endpoint for a page redrawn since the build', async () => {
    const { showcasePictureUrl } = await loadWith([BAKED]);

    // Same page, later drawing: the build's picture is of the old one, and
    // showing it would be silently stale.
    const url = showcasePictureUrl(101, 1, '2026-09-01T10:00:00.000Z');
    expect(url).toContain('/api/showcase?format=image');
    expect(url).toContain('page=101');
    expect(url).not.toContain('/showcase/101-1-');
  });

  it('falls back to the endpoint for a page put on the strip since the build', async () => {
    const { showcasePictureUrl } = await loadWith([BAKED]);

    expect(showcasePictureUrl(222, 1, '2026-09-01T10:00:00.000Z')).toContain(
      '/api/showcase?format=image',
    );
  });

  it('asks the endpoint when the build left no block at all', async () => {
    // A contributor's checkout, or a build that could not reach the database:
    // the front page is slower, and it still works.
    const { showcasePictureUrl } = await loadWith(undefined);

    expect(showcasePictureUrl(101, 1, BAKED.updated_at)).toContain('/api/showcase');
  });

  it('asks the endpoint when the block is not readable', async () => {
    const { showcasePictureUrl } = await loadWith('{ not json');

    expect(showcasePictureUrl(101, 1, BAKED.updated_at)).toContain('/api/showcase');
  });
});
