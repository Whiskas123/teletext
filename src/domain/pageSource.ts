/**
 * Where a screen came from: which archive capture, with which transforms.
 *
 * This used to live in the database (`published_pages`), keyed by page number,
 * while the screen itself lived in playhtml — two maps of the same service, kept
 * in step by hand. Every move had to renumber both, and any step that did not
 * finish left them disagreeing: a record pointing at a page that was not there,
 * blocking numbers the page list showed as free.
 *
 * Now it lives beside the screen, in playhtml's `page-sources` channel, keyed
 * exactly like the `pages` channel (`220`, `220.2`). A renumbering, a merge or a
 * delete moves or clears it in the same write as the cells, so the two cannot
 * come apart. The database still has it — the live mirror copies every channel
 * into `live_pages` — but only ever as a copy.
 *
 * Denormalised on purpose: the page list shows a screen's source, topic and
 * bottom bar without asking the database anything.
 *
 * Pure and framework-free.
 */

import { bootPage } from './bootData';

/** Stable playhtml channel id for where each screen came from. */
export const SOURCES_CHANNEL = 'page-sources';

export interface PageSource {
  captureId: number;
  source: 'rtp' | 'sic';
  originalPage: number;
  /** The capture's own subpage label, verbatim (`01`, `0002`). */
  sub: string;
  topic: string | null;
  scheme: string | null;
  firstSeen: string | null;
  manifestTitle: string | null;
  shiftDown: boolean;
  /** The saved bottom bar written over the last row, or null for the capture's own. */
  menuId: number | null;
  menuName: string | null;
  /** ISO time it was published. */
  publishedAt: string;
  /**
   * Fingerprint of the cells as published, or null when unknown. When the live
   * cells no longer match it, the screen was edited by hand since — and
   * re-publishing it from the capture would undo those edits.
   */
  cellsDigest: string | null;
}

/** Sources keyed like the `pages` channel. */
export type PageSources = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/**
 * A stored entry, checked — or null when it is not one. The channel is part of
 * a shared document anyone's browser can write, so what comes back is read
 * defensively rather than trusted to have the shape it was written with.
 */
export function readSource(raw: unknown): PageSource | null {
  if (raw == null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const captureId = int(value.captureId);
  const originalPage = int(value.originalPage);
  if (captureId == null || originalPage == null) return null;
  if (value.source !== 'rtp' && value.source !== 'sic') return null;
  return {
    captureId,
    source: value.source,
    originalPage,
    sub: str(value.sub) ?? '',
    topic: str(value.topic),
    scheme: str(value.scheme),
    firstSeen: str(value.firstSeen),
    manifestTitle: str(value.manifestTitle),
    shiftDown: value.shiftDown === true,
    menuId: int(value.menuId),
    menuName: str(value.menuName),
    publishedAt: str(value.publishedAt) ?? '',
    cellsDigest: str(value.cellsDigest),
  };
}

/** `RTP 220-01`: how a source is named on screen. */
export function describeSource(source: Pick<PageSource, 'source' | 'originalPage' | 'sub'>): string {
  return `${source.source.toUpperCase()} ${source.originalPage}${source.sub ? `-${source.sub}` : ''}`;
}

/**
 * cyrb53: a fast 53-bit string hash, shared by every fingerprint here and in
 * the live mirror. Not cryptographic, and does not need to be — it only has to
 * notice a change.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A screen's cells, fingerprinted. Normalised first, so the same picture has
 * the same fingerprint however it was stored.
 */
export function cellsDigest(cells: unknown): string {
  return fingerprint(JSON.stringify(bootPage(cells)));
}

/** Whether a published screen has been edited by hand since. */
export function editedSincePublished(source: PageSource, liveCells: unknown): boolean {
  return source.cellsDigest != null && source.cellsDigest !== cellsDigest(liveCells);
}
