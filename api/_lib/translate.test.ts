import { describe, expect, it } from 'vitest';

import { byId } from './translate';

describe('byId', () => {
  it('keys the reply by segment id, whatever order it came in', () => {
    const reply = { translations: [{ id: 's1', text: 'B' }, { id: 's0', text: 'A' }] };
    expect(byId(reply, ['s0', 's1'])).toEqual({ s0: 'A', s1: 'B' });
  });

  it('refuses a reply that skipped a segment', () => {
    const reply = { translations: [{ id: 's0', text: 'A' }] };
    expect(() => byId(reply, ['s0', 's1', 'title'])).toThrow('Reply skipped 2 segment(s): s1, title');
  });
});
