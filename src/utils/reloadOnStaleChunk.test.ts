import { describe, expect, it } from 'vitest';

import { shouldReload } from './reloadOnStaleChunk';

describe('shouldReload', () => {
  it('reloads the first time', () => {
    expect(shouldReload(null, 1_000_000)).toBe(true);
  });

  it('does not reload again straight after a reload', () => {
    expect(shouldReload('1000000', 1_005_000)).toBe(false);
  });

  it('reloads again once the window has passed', () => {
    expect(shouldReload('1000000', 1_011_000)).toBe(true);
  });

  it('treats a garbled value as no previous reload', () => {
    expect(shouldReload('nonsense', 1_000_000)).toBe(true);
  });
});
