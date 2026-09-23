/**
 * Which tab the manage screen is showing, and how that lives in the URL.
 *
 * `/manage` is three screens sharing a header: the pages (with the archive as
 * a pane beside them, so captures can be dragged straight into the list), the
 * strip chosen for the front page, and the saved bottom bars. Which one you
 * are looking at belongs in the URL so a link can open the one you mean — and
 * once it is in the URL it has to survive whatever arrives there, including a
 * value someone typed by hand, or a link saved before the tabs were renamed.
 *
 * Pure and framework-free, like the rest of `src/domain/`, so the parsing rules
 * are property-tested without a router or a rendered tab.
 *
 * ## Absent is not the same as wrong
 *
 * A missing `tab` parameter and a misspelled one both resolve to the default
 * tab, but only the misspelled one is worth rewriting: landing on a bare
 * `/manage` should leave the URL bare rather than immediately replacing the
 * history entry with one the visitor did not ask for.
 */

/** The identifier of a tab as it appears in the URL. */
export type TabKey = 'pages' | 'front' | 'bars';

/** Every tab, in the order the tab bar lists them. */
export const TAB_KEYS: readonly TabKey[] = ['pages', 'front', 'bars'];

/** The tab shown when the URL says nothing usable. */
export const DEFAULT_TAB: TabKey = 'pages';

/**
 * Names the tabs had before the archive became a pane of the pages tab. A link
 * saved with one of these still opens the right screen, and is rewritten.
 */
const LEGACY: Readonly<Record<string, { tab: TabKey; archive: boolean }>> = {
  'on-air': { tab: 'pages', archive: false },
  archive: { tab: 'pages', archive: true },
  showcase: { tab: 'front', archive: false },
};

/** The URL value for a tab. Inverse of {@link parseTabKey}. */
export function tabParam(tab: TabKey): string {
  return tab;
}

/**
 * The tab a raw parameter names, or `null` for anything else.
 *
 * Case-sensitive on purpose: accepting two spellings would mean two URLs for
 * one tab with no reason to prefer either.
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
  /** Whether the archive pane should start open (an old `?tab=archive` link). */
  archive: boolean;
}

/**
 * Resolve however many `tab` values a URL carried.
 *
 * More than one is not a choice between them, so it is treated the same as a
 * value that does not parse: fall back to the default and say the URL is not
 * canonical.
 */
export function resolveTabParam(raw: readonly string[]): ResolvedTab {
  const values = Array.isArray(raw) ? raw : [];

  if (values.length === 0) {
    return { tab: DEFAULT_TAB, canonical: true, present: false, archive: false };
  }
  if (values.length > 1) {
    return { tab: DEFAULT_TAB, canonical: false, present: true, archive: false };
  }

  const parsed = parseTabKey(values[0]);
  if (parsed != null) {
    return { tab: parsed, canonical: true, present: true, archive: false };
  }
  const legacy = Object.hasOwn(LEGACY, values[0]) ? LEGACY[values[0]] : undefined;
  return legacy != null
    ? { ...legacy, canonical: false, present: true }
    : { tab: DEFAULT_TAB, canonical: false, present: true, archive: false };
}

/** The keys the tab bar responds to. */
export type TabNavKey = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

/** Keyboard traversal of the tab list. Arrows wrap at both ends. */
export function tabForKey(current: TabKey, key: TabNavKey): TabKey {
  const last = TAB_KEYS.length - 1;
  if (key === 'Home') return TAB_KEYS[0];
  if (key === 'End') return TAB_KEYS[last];

  const index = TAB_KEYS.indexOf(current);
  const from = index === -1 ? 0 : index;
  const step = key === 'ArrowRight' ? 1 : -1;
  return TAB_KEYS[(from + step + TAB_KEYS.length) % TAB_KEYS.length];
}
