/**
 * Decisions for importing a whole folder of archive renders at once.
 *
 * Everything a batch import has to work out before it can run — which page
 * each file is destined for, and what is stopping it — as pure functions, so
 * the screen that drives it (`components/Room/ImportArchivePage`) only has to
 * render the answers.
 *
 * The page number comes from the filename, because the render itself does not
 * carry one: the archive names its files after the page (`163-01.gif` is page
 * 163, subpage 01) and blanks the header row where a real teletext page would
 * show it. See {@link pageNumberFromFileName}.
 */

import { canEditPage } from './access';
import { MAX_PAGE, MIN_PAGE, inPageRange } from './pageOps';

/**
 * The page number a filename refers to, or `null` if it does not name one.
 *
 * The first group of exactly three digits wins, which reads `163-01.gif`,
 * `163.gif` and `rtp-163-01.gif` alike as page 163. Requiring the group to be
 * exactly three digits long is what makes it skip the parts that are not page
 * numbers — a `2024-163-01.gif` resolves to 163, not 2024, and the `01`
 * subpage suffix is never mistaken for a page on its own.
 *
 * Total: returns `null` rather than throwing for any string, including one
 * with no digits at all.
 */
export function pageNumberFromFileName(fileName: string): number | null {
  // The extension is dropped before searching, so a numeric one is never
  // mistaken for the page number.
  const base = fileName.replace(/\.[^.]*$/, '');
  for (const match of base.matchAll(/\d+/g)) {
    if (match[0].length !== 3) continue;
    const value = Number(match[0]);
    if (inPageRange(value)) return value;
  }
  return null;
}

/** Everything an archive filename says about the render inside it. */
export interface ArchiveFileInfo {
  pageNumber: number | null;
  /**
   * Which screen of a multi-screen page this is (the `02` in
   * `163-02_20010606105327.gif`), or `null` if the name does not say. Our
   * pages hold one screen each, so anything past the first needs somewhere
   * else to go.
   */
  subpage: number | null;
  /**
   * When the page was captured, as the archive's sortable `YYYYMMDDHHMMSS`
   * stamp, or `null` if the name does not carry one. Compared as a string —
   * fixed-width digits already sort chronologically, and parsing it into a
   * date would only invent a timezone the filename never had.
   */
  capturedAt: string | null;
}

/**
 * Read an archive filename apart. The naming the RTP corpus uses is
 * `PAGE-SUBPAGE_TIMESTAMP.gif`; anything it does not follow still yields
 * whatever parts are recognisable, down to `pageNumber` alone.
 */
export function parseArchiveFileName(fileName: string): ArchiveFileInfo {
  const pageNumber = pageNumberFromFileName(fileName);
  if (pageNumber == null) return { pageNumber: null, subpage: null, capturedAt: null };

  // Anchored on the page number actually resolved, so the subpage and stamp
  // are read from the same run of the name rather than from anywhere in it.
  const base = fileName.replace(/\.[^.]*$/, '');
  const parts = new RegExp(`${pageNumber}(?:-(\\d{1,3}))?(?:_(\\d{8,14}))?`).exec(base);
  return {
    pageNumber,
    subpage: parts?.[1] != null ? Number(parts[1]) : null,
    capturedAt: parts?.[2] ?? null,
  };
}

/**
 * The ids to keep when reducing a batch to one render per page number — the
 * way out of an archive dump, where the same page appears once per capture
 * (up to dozens of times) and again for each screen of a multi-screen story.
 *
 * Within a page: the earliest screen wins, because that is the one the page
 * number actually refers to; between captures of that screen, `prefer` decides.
 * Entries with no page number are all kept — they are separately unset, not
 * duplicates of one another, and dropping them would silently discard files
 * whose number the person still has to type.
 */
export function chooseOnePerPage<T extends { id: string; info: ArchiveFileInfo }>(
  entries: readonly T[],
  prefer: 'newest' | 'oldest',
): ReadonlySet<string> {
  const best = new Map<number, T>();
  const keep = new Set<string>();

  for (const entry of entries) {
    const { pageNumber } = entry.info;
    if (pageNumber == null) {
      keep.add(entry.id);
      continue;
    }
    const incumbent = best.get(pageNumber);
    if (incumbent == null || preferredOver(entry.info, incumbent.info, prefer)) {
      best.set(pageNumber, entry);
    }
  }

  for (const entry of best.values()) keep.add(entry.id);
  return keep;
}

/** Whether `candidate` should displace `incumbent` as a page's chosen render. */
function preferredOver(
  candidate: ArchiveFileInfo,
  incumbent: ArchiveFileInfo,
  prefer: 'newest' | 'oldest',
): boolean {
  // A missing subpage is treated as the first screen: a plain `163.gif` is the
  // page itself, not some later screen of it.
  const candidateScreen = candidate.subpage ?? 1;
  const incumbentScreen = incumbent.subpage ?? 1;
  if (candidateScreen !== incumbentScreen) return candidateScreen < incumbentScreen;

  // An undated file never displaces a dated one; between two undated files the
  // first seen stays, so the order files were added in is preserved.
  if (candidate.capturedAt == null) return false;
  if (incumbent.capturedAt == null) return true;
  return prefer === 'newest'
    ? candidate.capturedAt > incumbent.capturedAt
    : candidate.capturedAt < incumbent.capturedAt;
}

/**
 * Page numbers claimed by more than one entry. `null` entries (no number yet)
 * never count as duplicates of each other — they are all separately unset,
 * not all the same page.
 */
export function duplicatePageNumbers(
  pageNumbers: readonly (number | null)[],
): ReadonlySet<number> {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const pageNumber of pageNumbers) {
    if (pageNumber == null) continue;
    if (seen.has(pageNumber)) duplicates.add(pageNumber);
    else seen.add(pageNumber);
  }
  return duplicates;
}

/**
 * `count` consecutive page numbers starting at `start`, for renumbering a
 * batch onto pages the importer is allowed to write — the one-click way out of
 * a pile of duplicates, and the only way in for anyone who is not the
 * moderator (the archive range is theirs alone).
 *
 * Runs off the end of the range rather than wrapping onto low page numbers:
 * the numbers past {@link MAX_PAGE} come back as `null` so the caller shows
 * them as unset instead of quietly landing them on some unrelated page.
 */
export function sequentialPageNumbers(
  count: number,
  start: number,
): (number | null)[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const pageNumber = start + i;
    return inPageRange(pageNumber) ? pageNumber : null;
  });
}

/** What is wrong with one entry, or `null` when it is ready to import. */
export type EntryIssue =
  /** The file could not be read as an archive render at all. */
  | { kind: 'unreadable'; detail: string }
  /** No page number: the filename did not name one and nobody typed one. */
  | { kind: 'no-page-number' }
  /** A page number was given, but it is not a page. */
  | { kind: 'out-of-range' }
  /** Another entry in the batch is aimed at the same page. */
  | { kind: 'duplicate' }
  /** An archive page, and this member is not the moderator. */
  | { kind: 'archive-locked' }
  /** Importable, but some characters were not recognised. */
  | { kind: 'unknown-glyphs'; cells: number };

export interface EntryState {
  /** Why the file could not be decoded, or `null` if it was. */
  unreadable: string | null;
  /** Where it is headed, or `null` if that is still unset. */
  pageNumber: number | null;
  /** Whether another entry claims the same page (see {@link duplicatePageNumbers}). */
  duplicate: boolean;
  isModerator: boolean;
  /** How many cells decoded to a stencil the atlas does not know. */
  unknownCells: number;
}

/**
 * The single most important thing wrong with an entry, or `null` when it is
 * ready. Ordered worst-first so a card shows the thing that actually needs
 * doing: an unreadable file's page number does not matter yet, and an
 * unrecognised character is worth mentioning only once the page is otherwise
 * good to go.
 */
export function entryIssue(state: EntryState): EntryIssue | null {
  if (state.unreadable != null) return { kind: 'unreadable', detail: state.unreadable };
  if (state.pageNumber == null) return { kind: 'no-page-number' };
  if (!inPageRange(state.pageNumber)) return { kind: 'out-of-range' };
  if (state.duplicate) return { kind: 'duplicate' };
  if (!canEditPage(state.pageNumber, state.isModerator)) return { kind: 'archive-locked' };
  if (state.unknownCells > 0) return { kind: 'unknown-glyphs', cells: state.unknownCells };
  return null;
}

/**
 * Whether an issue stops the entry importing, as opposed to just being worth
 * knowing. Unrecognised characters do not block: they import as blanks, and
 * leaving them for someone to type over beats refusing the whole page.
 */
export function blocksImport(issue: EntryIssue | null): boolean {
  return issue != null && issue.kind !== 'unknown-glyphs';
}

/** One line explaining an issue, for the card it belongs to. */
export function describeIssue(issue: EntryIssue | null): string {
  if (issue == null) return 'Ready';
  switch (issue.kind) {
    case 'unreadable':
      return issue.detail;
    case 'no-page-number':
      return 'No page number — the filename doesn’t contain one, so type it above.';
    case 'out-of-range':
      return `Not a page number (must be ${MIN_PAGE}–${MAX_PAGE}).`;
    case 'duplicate':
      return 'Another file is going to this same page.';
    case 'archive-locked':
      return 'An archive page — only the moderator can import here.';
    case 'unknown-glyphs':
      return `${issue.cells} unrecognised character${issue.cells === 1 ? '' : 's'} — will import blank.`;
  }
}
