/**
 * Normalising the two corpus manifests into one shape.
 *
 * `archive-corpus-rtp/manifest.json` and `archive-corpus-sic/manifest.json`
 * describe the same kind of thing — a captured teletext page render — but they
 * do not agree on how. The differences are small, and every one of them is a
 * chance to silently mis-file a capture, so they are resolved here, once, in a
 * pure module the tests can drive without touching the filesystem.
 *
 * What differs:
 *
 * - **`tier` vs `bucket`.** These sit in the same position in the two files and
 *   mean unrelated things. RTP's `tier` is the render resolution the capture was
 *   kept at (`gif3` 520x400 > `gif2` 400x300 > `gif1` 320x250). SIC's `bucket`
 *   is the page hundred-band (`100`..`800`), derivable from the page number.
 *   They are kept as separate fields rather than merged.
 * - **`sub` width.** RTP writes `'01'`, SIC writes `'0001'`. The raw label is
 *   kept verbatim and a parsed {@link CaptureRecord.subIndex} is derived for
 *   ordering, so `'01'` and `'0001'` sort together.
 * - **`title`.** RTP entries carry one (sometimes `null`); SIC entries have no
 *   such field at all.
 * - **`superseded`.** RTP only, and dropped: it lists lower-resolution copies of
 *   a kept page that were deliberately not retained.
 *
 * What is easy to get wrong and matters:
 *
 * - **`timestamps` is an array**, holding up to nine entries — one per day the
 *   capture was seen. Reading only the first would throw away the fact that a
 *   page was on air for years, which is exactly the kind of thing that decides
 *   between two candidates for the same page number. Hence `firstSeen`,
 *   `lastSeen`, and `captureCount`.
 * - **`page` is not a version key.** Broadcasters reused numbers for unrelated
 *   content across the years, so captures sharing a number are usually different
 *   pages, not revisions. Nothing here deduplicates by page number.
 */

/** Which corpus a capture came from. */
export type ArchiveSource = 'rtp' | 'sic';

/** Every corpus source, for callers that have to iterate them. */
export const ARCHIVE_SOURCES: readonly ArchiveSource[] = ['rtp', 'sic'];

/** Where a capture's topic was read from. */
export type TopicSource = 'folder' | 'manifest';

/** A capture, in the single shape the database and the admin UI both use. */
export interface CaptureRecord {
  source: ArchiveSource;
  /** Page number as broadcast. Not limited to the publishable 100..699 range. */
  originalPage: number;
  /** Raw subpage label, verbatim: `'01'` (RTP) or `'0001'` (SIC). */
  sub: string;
  /** `sub` parsed to a number, so the two label widths order together. */
  subIndex: number | null;
  digest: string;
  sourceUrl: string | null;
  /** Path within `archive-corpus-<source>/` — how to find the image again. */
  corpusFile: string;
  /** Path in the original archive dump. Provenance only. */
  sourceFile: string | null;
  bytes: number | null;
  /** Whether the capture is at native resolution rather than an upscale. */
  native: boolean | null;
  /** Full topic, nesting included: `'noticias'`, `'eventos/expo-98'`. */
  topic: string | null;
  /** Leading segment of a nested topic: `'eventos'` for `'eventos/expo-98'`. */
  topicGroup: string | null;
  /** How the manifest's classifier decided: `'header'`, `'page-band'`, ... */
  topicDecidedBy: string | null;
  /** Whether {@link topic} came from the on-disk folder or the manifest field. */
  topicSource: TopicSource;
  /** Render era: `'1998-2000'`, `'2001-2005'`, `'2006-2010'`. */
  scheme: string | null;
  /** Earliest day this capture was seen. */
  firstSeen: Date | null;
  /** Latest day this capture was seen. */
  lastSeen: Date | null;
  /** How many distinct days it was captured — a rough "how long it aired". */
  captureCount: number;
  /** RTP only: resolution tier the capture was kept at. */
  tier: string | null;
  /** SIC only: page hundred-band. */
  bucket: string | null;
  /** RTP only: the page's own title line, when the manifest recorded one. */
  manifestTitle: string | null;
  width: number;
  height: number;
}

/** The manifest as a whole, as far as this module cares about it. */
export interface ArchiveManifest {
  images_index?: unknown;
}

/**
 * Parse an archive timestamp (`YYYYMMDDHHMMSS`, UTC) into a `Date`.
 *
 * Returns `null` for anything not exactly fourteen digits, or for digits that
 * do not describe a real instant — `Date` would otherwise happily roll a month
 * of `13` over into the next year and file the capture under a date that never
 * existed.
 */
export function parseArchiveTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{14}$/.test(raw)) return null;

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Reject a rolled-over date (month 13, day 32, hour 25) by checking the
  // components survived the round trip intact.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

/**
 * The leading segment of a topic path: `'eventos'` for `'eventos/expo-98'`,
 * and the topic itself when it is not nested.
 *
 * Lets the admin UI offer both "everything filed under events" and one specific
 * event without storing the relationship twice.
 */
export function topicGroupOf(topic: string | null): string | null {
  if (topic == null || topic.length === 0) return null;
  const slash = topic.indexOf('/');
  return slash === -1 ? topic : topic.slice(0, slash);
}

/** A trimmed string, or `null` for anything absent, blank, or not a string. */
function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A finite number, or `null`. Accepts the numeric strings the manifests use. */
function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The sorted, de-duplicated instants a capture was seen, from its `timestamps`.
 *
 * De-duplication is not tidying: RTP repeats each instant once per resolution
 * tier it was captured at, so the raw array over-counts by up to 3x. One real
 * entry lists nine timestamps for three distinct days. Taking the array length
 * as a capture count would claim a page aired three times as long as it did,
 * and capture count is one of the signals used to choose between candidates for
 * the same page number.
 *
 * Unparseable entries are dropped rather than failing the whole record — one
 * bad timestamp should not cost us the capture.
 */
function seenDates(value: unknown): Date[] {
  if (!Array.isArray(value)) return [];
  const times = value
    .map(parseArchiveTimestamp)
    .filter((date): date is Date => date != null)
    .map((date) => date.getTime());
  return [...new Set(times)].sort((a, b) => a - b).map((time) => new Date(time));
}

/**
 * Normalise one manifest entry.
 *
 * Returns `null` when the entry lacks what makes it usable at all — a numeric
 * page, a digest, and a file to load — rather than writing a row that can never
 * be resolved back to an image.
 */
export function normalizeManifestEntry(
  source: ArchiveSource,
  entry: unknown,
): CaptureRecord | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;

  const originalPage = optionalNumber(raw.page);
  const digest = optionalString(raw.digest);
  const corpusFile = optionalString(raw.file);
  const width = optionalNumber(raw.width);
  const height = optionalNumber(raw.height);

  if (
    originalPage == null ||
    !Number.isInteger(originalPage) ||
    digest == null ||
    corpusFile == null ||
    width == null ||
    height == null
  ) {
    return null;
  }

  const sub = optionalString(raw.sub) ?? '';
  const subIndex = /^\d+$/.test(sub) ? Number(sub) : null;
  const topic = optionalString(raw.topic);
  const dates = seenDates(raw.timestamps);

  return {
    source,
    originalPage,
    sub,
    subIndex,
    digest,
    sourceUrl: optionalString(raw.url),
    corpusFile,
    sourceFile: optionalString(raw.source_file),
    bytes: optionalNumber(raw.bytes),
    native: typeof raw.native === 'boolean' ? raw.native : null,
    topic,
    topicGroup: topicGroupOf(topic),
    topicDecidedBy: optionalString(raw.decided_by),
    // The manifest's own classification, until the importer locates the file
    // and {@link relocateCapture} replaces it with where it is actually filed.
    topicSource: 'manifest',
    scheme: optionalString(raw.scheme),
    firstSeen: dates[0] ?? null,
    lastSeen: dates.length > 0 ? dates[dates.length - 1] : null,
    // A capture with no parseable timestamp was still captured once.
    captureCount: Math.max(1, dates.length),
    // Source-specific, and deliberately not merged: see the module comment.
    tier: source === 'rtp' ? optionalString(raw.tier) : null,
    bucket: source === 'sic' ? optionalString(raw.bucket) : null,
    manifestTitle: optionalString(raw.title),
    width,
    height,
  };
}

/**
 * The topic a corpus path files a capture under: everything before the
 * filename. `'eventos/expo-98/163-01.gif'` is filed under `'eventos/expo-98'`,
 * nesting intact. A path with no folder has no topic.
 */
export function topicFromPath(corpusFile: string): string | null {
  const lastSlash = corpusFile.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return corpusFile.slice(0, lastSlash);
}

/**
 * Re-point a capture at where its image is actually filed, taking the topic
 * from that folder.
 *
 * The RTP corpus was curated by hand after its manifest was generated: 236
 * captures now sit in a different topic folder than the manifest records, and
 * 70 of those moved into a `horoscopo` folder the manifest has no concept of.
 * The folders are therefore both newer and more considered than the `topic`
 * field, and they are the division the archive is browsed by — so when the two
 * disagree, the folder wins and {@link CaptureRecord.topicSource} records that
 * it did.
 *
 * The manifest's own `decided_by` is left alone: it still describes how the
 * automatic classifier reached its (now superseded) answer.
 */
export function relocateCapture(
  record: CaptureRecord,
  corpusFile: string,
): CaptureRecord {
  const topic = topicFromPath(corpusFile) ?? record.topic;
  return {
    ...record,
    corpusFile,
    topic,
    topicGroup: topicGroupOf(topic),
    topicSource: topic === record.topic ? record.topicSource : 'folder',
  };
}

/** Outcome of reading a whole manifest. */
export interface ManifestReadResult {
  captures: CaptureRecord[];
  /** How many entries were dropped as unusable (see {@link normalizeManifestEntry}). */
  skipped: number;
}

/**
 * Normalise every entry in a manifest's `images_index`.
 *
 * Duplicate `(source, digest)` pairs are collapsed, keeping the first — the
 * database holds a unique constraint on that pair, and a duplicate inside one
 * manifest should not fail the whole import.
 */
export function readManifest(
  source: ArchiveSource,
  manifest: ArchiveManifest,
): ManifestReadResult {
  const index = manifest.images_index;
  if (!Array.isArray(index)) return { captures: [], skipped: 0 };

  const captures: CaptureRecord[] = [];
  const seenDigests = new Set<string>();
  let skipped = 0;

  for (const entry of index) {
    const record = normalizeManifestEntry(source, entry);
    if (record == null) {
      skipped += 1;
      continue;
    }
    if (seenDigests.has(record.digest)) {
      skipped += 1;
      continue;
    }
    seenDigests.add(record.digest);
    captures.push(record);
  }

  return { captures, skipped };
}
