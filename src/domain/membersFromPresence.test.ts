import { describe, expect, it } from 'vitest';

import { colorForMember, defaultDisplayName, membersFromPresence } from './identity';

describe('membersFromPresence', () => {
  const me = { memberId: 'me', name: 'Ana', color: 'cyan' };

  it('counts only clients publishing on the channel, and always me', () => {
    // undefined: connected elsewhere on the site, not in this room.
    const entries = [undefined, { memberId: 'b', name: 'Bea', color: 'red' }, null, 'junk', {}];
    expect(membersFromPresence(entries, me)).toEqual([
      { memberId: 'b', name: 'Bea', color: 'red' },
      me,
    ]);
    expect(membersFromPresence(entries)).toHaveLength(1);
    expect(membersFromPresence([])).toEqual([]);
  });

  it('repairs a bad name or color and collapses duplicate ids', () => {
    const entries = [
      { memberId: 'b', name: '', color: 7 },
      { memberId: 'b', name: 'x'.repeat(33) },
      { memberId: 'me', name: 'Stale echo of me', color: 'red' },
    ];
    expect(membersFromPresence(entries, me)).toEqual([
      { memberId: 'b', name: defaultDisplayName('b'), color: colorForMember('b') },
      me,
    ]);
  });
});
