import { describe, expect, it } from 'vitest';

import { COLS } from '../types/teletext';
import { INDEX_LINE_RANGES } from './indexLine';

describe('INDEX_LINE_RANGES', () => {
  it('spans the row edge to edge, like space-between', () => {
    expect(INDEX_LINE_RANGES[0].start).toBe(0);
    expect(INDEX_LINE_RANGES[INDEX_LINE_RANGES.length - 1].end).toBe(COLS);
  });

  it('leaves at least one blank column between words', () => {
    for (let i = 1; i < INDEX_LINE_RANGES.length; i += 1) {
      expect(INDEX_LINE_RANGES[i].start).toBeGreaterThan(INDEX_LINE_RANGES[i - 1].end);
    }
  });
});
