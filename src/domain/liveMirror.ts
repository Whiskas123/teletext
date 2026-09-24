/**
 * Keeping the database's copy of the live pages in step with playhtml.
 *
 * playhtml is where the pages live: the editor writes there, visitors write
 * there, publishing writes there. `live_pages` in the database is the copy we
 * own — the backup, and what visitors are shown while playhtml is still
 * loading. It only ever *follows*: changes flow playhtml → database, never the
 * other way except as a deliberate restore.
 *
 * It used to follow only when someone pressed "Back up now", and even then it
 * never deleted: a page removed from the service lived on in the copy, and in
 * the fallback built from it. This module decides what the copy needs so that
 * it matches exactly, from a fingerprint of every screen on each side:
 *
 * - screens whose fingerprint differs (or that the copy lacks) are written;
 * - a page whose carousel got shorter has its extra screens deleted;
 * - a page that is no longer on the service at all is deleted.
 *
 * Deleting from the backup is the one thing that cannot be undone from the
 * backup, so it is held back when it looks like a mistake — when the live side
 * suddenly has far fewer pages than the copy, which is what a half-synced or
 * broken document looks like. Those wait for a person to confirm.
 *
 * Pure and framework-free.
 */

import { isHeadingKind, isPageKind, type PageKinds } from './directory';
import { bootPage } from './bootData';
import { fingerprint as hash, readSource, type PageSources } from './pageSource';
import { isNonEmptyPage } from './pageOps';
import { pageToArray } from './pageEncoding';
import { pageKey, parsePageKey, subpageCountOf, type SubpageCounts } from './subpages';

/** The live channels a mirror reads, as playhtml holds them. */
export interface LiveChannels {
  pages: Record<string, unknown>;
  titles: Record<string, unknown>;
  kinds: PageKinds;
  descriptions: Record<string, unknown>;
  counts: SubpageCounts;
  /** Where each archive screen came from (`page-sources`), keyed like `pages`. */
  sources?: PageSources;
}

/** One screen of the live service, fingerprinted. */
export interface LiveScreen {
  pageNumber: number;
  subpage: number;
  /** How many screens its page has; part of the fingerprint. */
  count: number;
  digest: string;
}

/** The key both sides are compared on: always `page.screen`. */
export const screenKey = (pageNumber: number, subpage: number) => `${pageNumber}.${subpage}`;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Every page the live service claims, by the same rule as `useOccupiedPages`:
 * something drawn on its first screen, a title, or a heading role.
 */
export function claimedPages(live: LiveChannels): number[] {
  const claimed = new Set<number>();
  for (const [key, stored] of Object.entries(live.pages ?? {})) {
    const parsed = parsePageKey(key);
    if (parsed == null || parsed.subpage !== 1) continue;
    if (isNonEmptyPage(pageToArray(stored))) claimed.add(parsed.pageNumber);
  }
  for (const [key, title] of Object.entries(live.titles ?? {})) {
    const pageNumber = Number(key);
    if (Number.isInteger(pageNumber) && text(title).trim() !== '') claimed.add(pageNumber);
  }
  for (const [key, kind] of Object.entries(live.kinds ?? {})) {
    const pageNumber = Number(key);
    if (Number.isInteger(pageNumber) && isPageKind(kind) && isHeadingKind(kind)) {
      claimed.add(pageNumber);
    }
  }
  return [...claimed].sort((a, b) => a - b);
}

/**
 * Every screen of every claimed page, fingerprinted. The fingerprint covers
 * everything the copy stores for a screen — its cells and its source, and the
 * page's title, role, description and screen count — so a change to any of
 * them is sent.
 */
export function liveScreens(live: LiveChannels): Map<string, LiveScreen> {
  const screens = new Map<string, LiveScreen>();
  for (const pageNumber of claimedPages(live)) {
    const count = subpageCountOf(live.counts, pageNumber);
    const meta = [
      text(live.titles?.[pageNumber]),
      String(live.kinds?.[pageNumber] ?? 'page'),
      text(live.descriptions?.[pageNumber]),
      count,
    ];
    for (let subpage = 1; subpage <= count; subpage += 1) {
      const key = String(pageKey(pageNumber, subpage));
      const cells = bootPage(live.pages?.[key]);
      const source = readSource(live.sources?.[key]);
      screens.set(screenKey(pageNumber, subpage), {
        pageNumber,
        subpage,
        count,
        digest: hash(JSON.stringify([cells, source, ...meta])),
      });
    }
  }
  return screens;
}

/** What the copy needs to match the live service. */
export interface MirrorPlan {
  /** Screens to write, as `page.screen` keys. */
  upserts: string[];
  /** Pages whose carousel got shorter: delete their screens past `count`. */
  truncate: { pageNumber: number; count: number }[];
  /** Pages no longer on the service: delete them from the copy. */
  removed: number[];
  /**
   * Deletions held back because they look like a broken document rather than
   * an edit. Sent only when a person confirms.
   */
  held: number[];
}

export interface MirrorOptions {
  /** Most pages one plan may delete on its own. */
  maxRemovals?: number;
  /** Deletions to send even if they would otherwise be held. */
  confirmed?: ReadonlySet<number>;
}

/**
 * Compare the live screens with the copy's fingerprints.
 *
 * `copy` maps `page.screen` to the fingerprint stored with it, or `null` for a
 * row stored before fingerprints existed — which always counts as changed.
 */
export function planMirror(
  live: ReadonlyMap<string, LiveScreen>,
  copy: ReadonlyMap<string, string | null>,
  { maxRemovals = 10, confirmed = new Set() }: MirrorOptions = {},
): MirrorPlan {
  const upserts: string[] = [];
  for (const [key, screen] of live) {
    if (copy.get(key) !== screen.digest) upserts.push(key);
  }

  const livePages = new Map<number, number>();
  for (const screen of live.values()) livePages.set(screen.pageNumber, screen.count);

  const truncate = new Map<number, number>();
  const gone = new Set<number>();
  for (const key of copy.keys()) {
    const [page, screen] = key.split('.').map(Number);
    const count = livePages.get(page);
    if (count == null) gone.add(page);
    else if (screen > count) truncate.set(page, count);
  }

  const removals = [...gone].sort((a, b) => a - b);
  // Held when there is nothing live at all, or when more would go at once than
  // any single edit plausibly removes. A person confirming releases them.
  const suspicious = live.size === 0 || removals.filter((p) => !confirmed.has(p)).length > maxRemovals;
  const removed = suspicious ? removals.filter((p) => confirmed.has(p)) : removals;
  const held = suspicious ? removals.filter((p) => !confirmed.has(p)) : [];

  return {
    upserts,
    truncate: [...truncate].map(([pageNumber, count]) => ({ pageNumber, count })),
    removed,
    held,
  };
}

/** Whether a plan has anything to do. */
export function isEmptyPlan(plan: MirrorPlan): boolean {
  return plan.upserts.length === 0 && plan.truncate.length === 0 && plan.removed.length === 0;
}

/** Apply a plan to the copy's fingerprints, once the server has confirmed it. */
export function applyMirrorPlan(
  copy: ReadonlyMap<string, string | null>,
  plan: MirrorPlan,
  live: ReadonlyMap<string, LiveScreen>,
): Map<string, string | null> {
  const next = new Map(copy);
  for (const key of plan.upserts) next.set(key, live.get(key)?.digest ?? null);
  const removed = new Set(plan.removed);
  const truncated = new Map(plan.truncate.map(({ pageNumber, count }) => [pageNumber, count]));
  for (const key of [...next.keys()]) {
    const [page, screen] = key.split('.').map(Number);
    if (removed.has(page)) next.delete(key);
    const count = truncated.get(page);
    if (count != null && screen > count) next.delete(key);
  }
  return next;
}
