// Keeping the database copy in step with the live pages: what gets written,
// what gets deleted, and when a deletion is held back for a person to confirm.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createEmptyPage } from '../types/teletext';
import {
  applyMirrorPlan,
  claimedPages,
  isEmptyPlan,
  liveScreens,
  planMirror,
  type LiveChannels,
} from './liveMirror';

function drawn(char: string) {
  const page = createEmptyPage();
  page[0] = { ...page[0], char };
  return Object.fromEntries(page.map((cell, index) => [index, cell]));
}

function channels(overrides: Partial<LiveChannels> = {}): LiveChannels {
  return {
    pages: { 100: drawn('A'), 101: drawn('B'), '101.2': drawn('C'), 700: drawn('D') },
    titles: { 100: 'Index' },
    kinds: {},
    descriptions: {},
    counts: { 101: 2 },
    ...overrides,
  };
}

/** The copy as it would be after a perfect mirror of `live`. */
const mirrored = (live: LiveChannels) =>
  new Map([...liveScreens(live)].map(([key, screen]) => [key, screen.digest as string | null]));

describe('what the live service claims', () => {
  it('counts drawn pages, titled pages and headings, like the page list does', () => {
    expect(
      claimedPages(
        channels({
          pages: { 100: drawn('A'), 102: {} },
          titles: { 103: 'Titled only', 104: '  ' },
          kinds: { 105: 'category', 106: 'page' },
        }),
      ),
    ).toEqual([100, 103, 105]);
  });

  it('fingerprints every screen of a carousel', () => {
    const screens = liveScreens(channels());
    expect([...screens.keys()]).toEqual(['100.1', '101.1', '101.2', '700.1']);
  });
});

describe('planning a mirror', () => {
  it('has nothing to do when the copy already matches', () => {
    const live = channels();
    expect(isEmptyPlan(planMirror(liveScreens(live), mirrored(live)))).toBe(true);
  });

  it('writes a screen when its cells, title, role, description or count change', () => {
    const before = channels();
    const copy = mirrored(before);
    const edits: Partial<LiveChannels>[] = [
      { pages: { ...before.pages, 100: drawn('Z') } },
      { titles: { 100: 'Renamed' } },
      { kinds: { 100: 'category' } },
      { descriptions: { 100: 'Now described' } },
    ];
    for (const edit of edits) {
      expect(planMirror(liveScreens(channels(edit)), copy).upserts).toEqual(['100.1']);
    }
  });

  it('deletes screens a carousel no longer has', () => {
    const before = channels();
    const plan = planMirror(liveScreens(channels({ counts: { 101: 1 } })), mirrored(before));
    expect(plan.truncate).toEqual([{ pageNumber: 101, count: 1 }]);
    // Its count changed, so its remaining screen is rewritten too.
    expect(plan.upserts).toEqual(['101.1']);
  });

  it('deletes a page that is no longer on the service', () => {
    const before = channels();
    const pages = { ...before.pages };
    delete pages[700];
    const plan = planMirror(liveScreens(channels({ pages })), mirrored(before));
    expect(plan.removed).toEqual([700]);
    expect(plan.held).toEqual([]);
  });

  it('writes rows stored before fingerprints existed', () => {
    const live = channels();
    const copy = new Map([...mirrored(live)].map(([key]) => [key, null]));
    expect(planMirror(liveScreens(live), copy).upserts).toHaveLength(4);
  });

  it('holds back deletions that look like a broken document, until confirmed', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [200 + i, drawn('x')]));
    const copy = mirrored(channels({ pages: many, titles: {}, counts: {} }));

    // Everything gone at once: nothing is deleted on its own say-so.
    const empty = planMirror(liveScreens(channels({ pages: {}, titles: {}, counts: {} })), copy);
    expect(empty.removed).toEqual([]);
    expect(empty.held).toHaveLength(30);

    // Confirmed by a person, they go.
    const confirmed = planMirror(liveScreens(channels({ pages: {}, titles: {}, counts: {} })), copy, {
      confirmed: new Set(empty.held),
    });
    expect(confirmed.removed).toHaveLength(30);
    expect(confirmed.held).toEqual([]);
  });

  it('after applying its plan, the copy always matches the live side', () => {
    const page = fc.integer({ min: 100, max: 130 });
    const arbLive = fc
      .record({
        drawn: fc.uniqueArray(page, { maxLength: 12 }),
        counts: fc.dictionary(page.map(String), fc.integer({ min: 1, max: 4 })),
      })
      .map(({ drawn: numbers, counts }) =>
        channels({
          pages: Object.fromEntries(numbers.map((n) => [n, drawn(String(n % 10))])),
          titles: {},
          counts: counts as unknown as LiveChannels['counts'],
        }),
      );
    fc.assert(
      fc.property(arbLive, arbLive, (before, after) => {
        const live = liveScreens(after);
        // An empty live side is held back on purpose; see the test above.
        fc.pre(live.size > 0);
        const plan = planMirror(live, mirrored(before), { maxRemovals: Infinity });
        const next = applyMirrorPlan(mirrored(before), plan, live);
        expect(next).toEqual(mirrored(after));
      }),
    );
  });
});
