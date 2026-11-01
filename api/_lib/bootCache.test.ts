// Feature: the boot pages kept compressed in Postgres (`GET /api/snapshot?boot`).
// Verifies: a read whose version matches is answered from the stored copy
// without building, one that does not builds and stores it, and a failed save
// still answers.

import { gunzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';

let stored: { version: string; body: string } | null = null;
let liveVersion = 'v1';
let saveFails = false;

vi.mock('./db', () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('').includes('insert into boot_cache')) {
      if (saveFails) return Promise.reject(new Error('save failed'));
      stored = { version: String(values[0]), body: String(values[1]) };
      return Promise.resolve([]);
    }
    const body = stored?.version === liveVersion ? stored.body : null;
    return Promise.resolve([{ version: liveVersion, body }]);
  },
}));

const { bootBody } = await import('./bootCache');

const unzip = (body: Buffer) => JSON.parse(gunzipSync(body).toString());

describe('the stored boot pages', () => {
  beforeEach(() => {
    stored = null;
    liveVersion = 'v1';
    saveFails = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('builds once, then answers from the stored copy', async () => {
    const build = vi.fn(async () => ({ pages: { 1: 'one' } }));

    expect(unzip(await bootBody(build))).toEqual({ pages: { 1: 'one' } });
    expect(unzip(await bootBody(build))).toEqual({ pages: { 1: 'one' } });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the pages have changed', async () => {
    await bootBody(async () => ({ pages: 'old' }));

    liveVersion = 'v2';
    expect(unzip(await bootBody(async () => ({ pages: 'new' })))).toEqual({ pages: 'new' });
    expect(stored?.version).toBe('v2');
  });

  it('still answers when the copy cannot be saved', async () => {
    saveFails = true;
    expect(unzip(await bootBody(async () => ({ pages: 'kept' })))).toEqual({ pages: 'kept' });
  });
});
