// Feature: collaborative-teletext-rooms, Property 4: Presence count matches the member list
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { presenceCount } from './identity';
import { ROOM_MAX_MEMBERS } from '../collab/types';

/**
 * Property 4: Presence count matches the member list.
 *
 * For any awareness set, the displayed member count equals the number of
 * members in the presence list and lies within the inclusive range 0 to the
 * room's maximum capacity (ROOM_MAX_MEMBERS).
 *
 * `presenceCount` clamps to `0..ROOM_MAX_MEMBERS`, so for any array of
 * member-like objects the count equals `min(members.length, ROOM_MAX_MEMBERS)`
 * and always stays within the capacity bounds — including empty rooms and
 * over-capacity lists.
 *
 * **Validates: Requirements 2.7**
 */

// A member-like object: the domain only cares about the list length, not the
// shape of each member, so any object stands in for an awareness entry.
const memberLike = fc.record({
  memberId: fc.string(),
  name: fc.string(),
});

describe('Property 4: Presence count matches the member list', () => {
  it('count equals min(members.length, ROOM_MAX_MEMBERS) and stays within 0..capacity', () => {
    fc.assert(
      fc.property(
        // Arbitrary member lists of any length: empty, small, and well beyond
        // capacity so the clamp boundary is exercised.
        fc.array(memberLike, { minLength: 0, maxLength: ROOM_MAX_MEMBERS * 3 }),
        (members) => {
          const count = presenceCount(members);

          // Count matches the member list, clamped to capacity (Req 2.7).
          expect(count).toBe(Math.min(members.length, ROOM_MAX_MEMBERS));

          // Count lies within the inclusive range 0..ROOM_MAX_MEMBERS (Req 2.7).
          expect(count).toBeGreaterThanOrEqual(0);
          expect(count).toBeLessThanOrEqual(ROOM_MAX_MEMBERS);
        },
      ),
      { numRuns: 200 },
    );
  });
});
