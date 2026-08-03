/**
 * Tests for the manage screen's tab keys and how they survive a URL.
 *
 * The property that matters is the round trip: selecting a tab writes a value,
 * and loading that value has to select the same tab. Anything else means a
 * shared link opens the wrong screen. The second property is that nothing else
 * can — no string, however arrived at, selects a tab that is not one of the two.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAB,
  TAB_KEYS,
  parseTabKey,
  resolveTabParam,
  tabForKey,
  tabParam,
  type TabNavKey,
} from './manageTabs';

const arbTab = fc.constantFrom(...TAB_KEYS);
const arbNavKey: fc.Arbitrary<TabNavKey> = fc.constantFrom(
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
);

describe('tabParam and parseTabKey', () => {
  it('round-trips every tab', () => {
    fc.assert(
      fc.property(arbTab, (tab) => {
        expect(parseTabKey(tabParam(tab))).toBe(tab);
      }),
    );
  });

  it('accepts nothing but the two keys, case included', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2048 }), (raw) => {
        const parsed = parseTabKey(raw);
        if (TAB_KEYS.some((key) => key === raw)) {
          expect(parsed).toBe(raw);
        } else {
          expect(parsed).toBeNull();
        }
      }),
    );
  });

  it('rejects a differently-cased key', () => {
    expect(parseTabKey('Archive')).toBeNull();
    expect(parseTabKey('ON-AIR')).toBeNull();
  });
});

describe('resolveTabParam', () => {
  it('resolves a single canonical value to its tab, unchanged', () => {
    fc.assert(
      fc.property(arbTab, (tab) => {
        expect(resolveTabParam([tabParam(tab)])).toEqual({
          tab,
          canonical: true,
          present: true,
        });
      }),
    );
  });

  it('leaves an absent parameter absent rather than correcting it', () => {
    // A bare /manage stays bare: there is nothing to fix, so nothing is written.
    expect(resolveTabParam([])).toEqual({
      tab: DEFAULT_TAB,
      canonical: true,
      present: false,
    });
  });

  it('falls back and asks to be rewritten for anything that is not a key', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2048 }), (raw) => {
        fc.pre(!TAB_KEYS.some((key) => key === raw));
        expect(resolveTabParam([raw])).toEqual({
          tab: DEFAULT_TAB,
          canonical: false,
          present: true,
        });
      }),
    );
  });

  it('treats a repeated parameter as no choice at all', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 32 }), { minLength: 2, maxLength: 5 }),
        (values) => {
          expect(resolveTabParam(values)).toEqual({
            tab: DEFAULT_TAB,
            canonical: false,
            present: true,
          });
        },
      ),
    );
  });

  it('rewrites to a value that then resolves canonically', () => {
    // The correction has to be a fixed point, or the screen would rewrite the
    // URL on every load.
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (raw) => {
        const first = resolveTabParam([raw]);
        const second = resolveTabParam([tabParam(first.tab)]);
        expect(second.tab).toBe(first.tab);
        expect(second.canonical).toBe(true);
      }),
    );
  });
});

describe('tabForKey', () => {
  it('always lands on a tab', () => {
    fc.assert(
      fc.property(arbTab, arbNavKey, (tab, key) => {
        expect(TAB_KEYS).toContain(tabForKey(tab, key));
      }),
    );
  });

  it('returns to where it started after a full lap in either direction', () => {
    fc.assert(
      fc.property(
        arbTab,
        fc.constantFrom<TabNavKey>('ArrowRight', 'ArrowLeft'),
        (tab, key) => {
          let current = tab;
          for (let step = 0; step < TAB_KEYS.length; step += 1) {
            current = tabForKey(current, key);
          }
          expect(current).toBe(tab);
        },
      ),
    );
  });

  it('wraps rather than stopping at either end', () => {
    const first = TAB_KEYS[0];
    const last = TAB_KEYS[TAB_KEYS.length - 1];
    expect(tabForKey(last, 'ArrowRight')).toBe(first);
    expect(tabForKey(first, 'ArrowLeft')).toBe(last);
  });

  it('sends Home to the first tab and End to the last, from anywhere', () => {
    fc.assert(
      fc.property(arbTab, (tab) => {
        expect(tabForKey(tab, 'Home')).toBe(TAB_KEYS[0]);
        expect(tabForKey(tab, 'End')).toBe(TAB_KEYS[TAB_KEYS.length - 1]);
      }),
    );
  });
});
