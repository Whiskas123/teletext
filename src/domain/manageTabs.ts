/**
 * Which tab the manage screen is showing, and how that lives in the URL.
 *
 * `/manage` is three screens sharing a header: the pages on air, the corpus
 * browser that puts pages there, and the strip chosen for the front page. Which
 * one you are looking at belongs in the URL so a link can open the one you
 * mean — and once it is in the URL it has to survive whatever arrives there,
 * including a value someone typed by hand.
 *
 * Pure and framework-free, like the rest of `src/domain/`, so the parsing rules
 * are property-tested without a router or a rendered tab.
 *
 * ## Absent is not the same as wrong
 *
 * A missing `tab` parameter and a misspelled one both resolve to the On Air
 * tab, but only the misspelled one is worth rewriting: landing on a bare
 * `/manage` should leave the URL bare rather than immediately replacing the
 * history entry with one the visitor did not ask for. `present` is what lets
 * the caller tell those two cases apart.
 */

/** The identifier of a tab as it appears in the URL. */
export type TabKey = 'on-air' | 'archive' | 'showcase';

/** Every tab, in the order the tab bar lists them. */
export const TAB_KEYS: readonly TabKey[] = ['on-air', 'archive', 'showcase'];

/** The tab shown when the URL says nothing usable. */
export const DEFAULT_TAB: TabKey = 'on-air';

/** The URL value for a tab. Inverse of {@link parseTabKey}. */
export function tabParam(tab: TabKey): string {
  return tab;
}

/**
 * The tab a raw parameter names, or `null` for anything else.
 *
 * Case-sensitive on purpose: `archive` and `Archive` are different strings, and
 * accepting both would mean two URLs for one tab with no reason to prefer
 * either. The mismatched one is rewritten to the canonical spelling instead.
 */
export function parseTabKey(raw: string): TabKey | null {
  if (typeof raw !== 'string') return null;
  return TAB_KEYS.find((key) => key === raw) ?? null;
}

/** What the URL asked for, and whether it asked in the canonical way. */
export interface ResolvedTab {
  /** The tab to select. */
  tab: TabKey;
  /** Whether the URL already spells this tab the one canonical way. */
  canonical: boolean;
  /** Whether the URL carried a `tab` parameter at all. */
  present: boolean;
}

/**
 * Resolve however many `tab` values a URL carried.
 *
 * More than one is not a choice between them — there is no reason to prefer the
 * first or the last — so it is treated the same as a value that does not parse:
 * fall back to the default and say the URL is not canonical.
 */
export function resolveTabParam(raw: readonly string[]): ResolvedTab {
  const values = Array.isArray(raw) ? raw : [];

  if (values.length === 0) {
    // Nothing to correct. A bare `/manage` stays bare.
    return { tab: DEFAULT_TAB, canonical: true, present: false };
  }

  if (values.length > 1) {
    return { tab: DEFAULT_TAB, canonical: false, present: true };
  }

  const parsed = parseTabKey(values[0]);
  return parsed == null
    ? { tab: DEFAULT_TAB, canonical: false, present: true }
    : { tab: parsed, canonical: true, present: true };
}

/** The keys the tab bar responds to. */
export type TabNavKey = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

/**
 * Keyboard traversal of the tab list.
 *
 * Arrows wrap at both ends, which with two tabs makes either arrow the "other
 * tab" — written against the index rather than special-cased so adding a third
 * tab needs nothing here.
 */
export function tabForKey(current: TabKey, key: TabNavKey): TabKey {
  const last = TAB_KEYS.length - 1;
  if (key === 'Home') return TAB_KEYS[0];
  if (key === 'End') return TAB_KEYS[last];

  const index = TAB_KEYS.indexOf(current);
  // An unknown current tab is treated as the first, so traversal still moves.
  const from = index === -1 ? 0 : index;
  const step = key === 'ArrowRight' ? 1 : -1;
  return TAB_KEYS[(from + step + TAB_KEYS.length) % TAB_KEYS.length];
}
