/**
 * Load both archive corpora into `archive_captures`.
 *
 *     bun run db:import-corpus            # both corpora
 *     bun run db:import-corpus --source rtp
 *     bun run db:import-corpus --limit 50 # a slice, for trying it out
 *
 * ## Every capture is catalogued; not every capture can be decoded
 *
 * RTP renders at three sizes the decoder knows (520x400, 400x300, 320x250), all
 * 25 rows. SIC renders at 320x240 and 480x336, which are 24-row layouts in a
 * different font — `importArchiveImage` rejects them, and no atlas exists for
 * them yet.
 *
 * Rather than skip 1,255 SIC captures, an undecodable one is still recorded:
 * its topic, era, page number, capture dates and file path all go in, with
 * `decode_status = 'unsupported-profile'` and no cells. The corpus is therefore
 * completely browsable and filterable from the start, and adding SIC support
 * later backfills cells with an UPDATE instead of a re-import.
 *
 * ## Re-running is safe
 *
 * Rows are upserted on `(source, digest)`, so a re-run repairs and updates
 * rather than duplicating. A capture that previously failed to decode and now
 * succeeds is upgraded in place.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import {
  ArchiveImportError,
  importArchiveImage,
  type ImportResult,
} from '../src/domain/archiveImport';
import {
  ARCHIVE_SOURCES,
  readManifest,
  relocateCapture,
  type ArchiveSource,
  type CaptureRecord,
} from '../src/domain/archiveManifest';
import { loadImageNode, encodeCaptureImage } from './lib/loadImageNode';
import { withPool } from './lib/pool';

const ROOT = join(import.meta.dirname, '..');

/** How many captures to send per INSERT. Keeps each statement well under any
 * payload limit while still amortising the round trip across many rows. */
const BATCH_SIZE = 25;

interface Options {
  sources: ArchiveSource[];
  limit: number | null;
  /** Decode everything and report, without touching the database. */
  dryRun: boolean;
}

function parseOptions(argv: string[]): Options {
  let sources = [...ARCHIVE_SOURCES];
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--source') {
      const value = argv[i + 1];
      if (value !== 'rtp' && value !== 'sic') {
        throw new Error(`--source must be rtp or sic, got ${String(value)}`);
      }
      sources = [value];
      i += 1;
    } else if (argv[i] === '--limit') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--limit must be a positive integer, got ${argv[i + 1]}`);
      }
      limit = value;
      i += 1;
    }
  }

  return { sources, limit, dryRun };
}

/**
 * Every image under a corpus, indexed by filename.
 *
 * The manifest's `file` path is not reliable: the RTP corpus was re-filed by
 * hand afterwards, so 236 of its captures live in a different topic folder than
 * recorded. Filenames carry page, subpage and timestamp and stay unique across
 * the corpus, so looking up by filename finds the image wherever it was moved
 * to — and the folder it is found in is the topic that gets stored.
 */
async function indexCorpus(dir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(gif|png)$/i.test(entry.name)) {
        index.set(entry.name, relative(dir, path));
      }
    }
  };
  await walk(dir);
  return index;
}

/** A capture plus whatever decoding it produced. */
interface DecodedCapture {
  record: CaptureRecord;
  status: 'ok' | 'unsupported-profile' | 'failed';
  detail: string | null;
  result: ImportResult | null;
  /** The render itself, re-encoded as lossless WebP for the admin browser. */
  image: Buffer | null;
}

/**
 * Decode one capture's image.
 *
 * An unrecognised render size is reported as `unsupported-profile` rather than
 * as a failure: nothing is wrong with the capture, the decoder simply has no
 * profile for it yet. Anything else — an unreadable file, a corrupt image — is
 * a genuine `failed`, and the two are worth telling apart when reviewing.
 */
async function decode(
  source: ArchiveSource,
  record: CaptureRecord,
): Promise<DecodedCapture> {
  const path = join(ROOT, `archive-corpus-${source}`, record.corpusFile);

  // The image is stored whether or not the decode succeeds: a capture with no
  // render profile yet is still worth looking at in the browser, and that is
  // how you would work out what profile it needs.
  let image: Buffer | null = null;
  try {
    image = await encodeCaptureImage(path);
  } catch {
    image = null;
  }

  try {
    const pixels = await loadImageNode(path);
    const result = importArchiveImage(pixels);
    return { record, status: 'ok', detail: null, result, image };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof ArchiveImportError && message.includes('Expected an archive render')
        ? 'unsupported-profile'
        : 'failed';
    return { record, status, detail: message, result: null, image };
  }
}

/** Column values for one capture, in the order the INSERT lists them. */
function rowValues(decoded: DecodedCapture): unknown[] {
  const { record, result } = decoded;
  return [
    record.source,
    record.originalPage,
    record.sub,
    record.subIndex,
    record.digest,
    record.sourceUrl,
    record.corpusFile,
    record.sourceFile,
    record.bytes,
    record.native,
    record.topic,
    record.topicGroup,
    record.topicDecidedBy,
    record.topicSource,
    record.scheme,
    record.firstSeen,
    record.lastSeen,
    record.captureCount,
    record.tier,
    record.bucket,
    record.manifestTitle,
    decoded.status,
    decoded.detail,
    result?.profile.name ?? null,
    record.width,
    record.height,
    // The array form, not the index map: it compresses roughly 40% better and
    // the map shape is a CRDT storage detail, not an archival one.
    result == null ? null : JSON.stringify(result.page),
    result?.droppedRow ?? null,
    result?.droppedRowHadContent ?? false,
    result?.snappedPixels ?? 0,
    result?.unknownGlyphs.length ?? 0,
    decoded.image,
  ];
}

const COLUMNS = [
  'source', 'original_page', 'sub', 'sub_index', 'digest', 'source_url',
  'corpus_file', 'source_file', 'bytes', 'native', 'topic', 'topic_group',
  'topic_decided_by', 'topic_source', 'scheme', 'first_seen', 'last_seen', 'capture_count',
  'tier', 'bucket', 'manifest_title', 'decode_status', 'decode_detail',
  'profile', 'width', 'height', 'cells', 'dropped_row', 'dropped_had_content',
  'snapped_pixels', 'unknown_glyphs', 'image',
] as const;

/** `insert ... on conflict (source, digest) do update ...` for `count` rows. */
function buildInsert(count: number): string {
  const tuples: string[] = [];
  for (let row = 0; row < count; row += 1) {
    const params = COLUMNS.map(
      (_, col) => `$${row * COLUMNS.length + col + 1}`,
    );
    // `cells` arrives as a JSON string and has to be told it is jsonb.
    const cellsAt = COLUMNS.indexOf('cells');
    params[cellsAt] = `${params[cellsAt]}::jsonb`;
    const imageAt = COLUMNS.indexOf('image');
    params[imageAt] = `${params[imageAt]}::bytea`;
    tuples.push(`(${params.join(', ')})`);
  }

  const updates = COLUMNS.filter((c) => c !== 'source' && c !== 'digest')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  return `
    insert into archive_captures (${COLUMNS.join(', ')})
    values ${tuples.join(', ')}
    on conflict (source, digest) do update set ${updates}, imported_at = now()
  `;
}

async function main(): Promise<void> {
  const { sources, limit, dryRun } = parseOptions(process.argv.slice(2));

  const totals = {
    ok: 0,
    unsupported: 0,
    failed: 0,
    suspect: 0,
    skippedEntries: 0,
    cellBytes: 0,
    absent: 0,
    refiled: 0,
  };
  const unsupportedSizes = new Map<string, number>();

  /**
   * Run `body` with a database, or with a no-op stand-in under `--dry-run` so
   * the decode path can be exercised in full before any database exists.
   */
  const withStore = async (
    body: (write: (batch: DecodedCapture[]) => Promise<void>) => Promise<void>,
  ): Promise<void> => {
    if (dryRun) {
      await body(async () => {});
      return;
    }
    await withPool(async (pool) => {
      await body(async (batch) => {
        if (batch.length === 0) return;
        await pool.query(buildInsert(batch.length), batch.flatMap(rowValues));
      });
    });
  };

  await withStore(async (write) => {
    for (const source of sources) {
      const manifestPath = join(ROOT, `archive-corpus-${source}`, 'manifest.json');
      const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      const { captures, skipped } = readManifest(
        source,
        manifest as { images_index?: unknown },
      );
      totals.skippedEntries += skipped;

      const corpusDir = join(ROOT, `archive-corpus-${source}`);
      const onDisk = await indexCorpus(corpusDir);

      // Point each capture at where its image actually is, and take the topic
      // from that folder. Captures whose image is nowhere on disk are dropped:
      // a row with no image can never be decoded or re-decoded.
      const located: CaptureRecord[] = [];
      let absent = 0;
      let refiled = 0;
      for (const record of captures) {
        const found = onDisk.get(basename(record.corpusFile));
        if (found == null) {
          absent += 1;
          continue;
        }
        const relocated = relocateCapture(record, found);
        if (relocated.topicSource === 'folder') refiled += 1;
        located.push(relocated);
      }
      totals.absent += absent;
      totals.refiled += refiled;

      const chosen = limit == null ? located : located.slice(0, limit);
      console.log(
        `\n${source.toUpperCase()}: ${chosen.length} captures ` +
          `(${skipped} duplicate manifest entries collapsed, ` +
          `${refiled} re-filed by folder, ${absent} images absent)`,
      );

      let batch: DecodedCapture[] = [];
      let done = 0;

      const flush = async (): Promise<void> => {
        if (batch.length === 0) return;
        await write(batch);
        batch = [];
      };

      for (const record of chosen) {
        const decoded = await decode(source, record);

        if (decoded.status === 'ok') {
          totals.ok += 1;
          const result = decoded.result;
          if (result != null) {
            totals.cellBytes += JSON.stringify(result.page).length;
            if (result.snappedPixels > 0 || result.unknownGlyphs.length > 0) {
              totals.suspect += 1;
            }
          }
        } else if (decoded.status === 'unsupported-profile') {
          totals.unsupported += 1;
          const size = `${record.width}x${record.height}`;
          unsupportedSizes.set(size, (unsupportedSizes.get(size) ?? 0) + 1);
        } else {
          totals.failed += 1;
          console.error(`  ! ${record.corpusFile}: ${decoded.detail}`);
        }

        batch.push(decoded);
        done += 1;

        if (batch.length >= BATCH_SIZE) {
          await flush();
          process.stdout.write(`\r  ${done}/${chosen.length} stored`);
        }
      }

      await flush();
      process.stdout.write(`\r  ${done}/${chosen.length} stored\n`);
    }
  });

  console.log(`\n--- summary ---${dryRun ? '  (dry run: nothing written)' : ''}`);
  console.log(`  decoded:              ${totals.ok}`);
  console.log(`  catalogued, no cells: ${totals.unsupported}`);
  console.log(`  failed:               ${totals.failed}`);
  console.log(`  suspect decodes:      ${totals.suspect}`);
  console.log(`  duplicate entries:    ${totals.skippedEntries}`);
  console.log(`  re-filed by folder:   ${totals.refiled}`);
  console.log(`  images absent:        ${totals.absent}`);
  if (totals.ok > 0) {
    const mb = totals.cellBytes / 1e6;
    console.log(
      `  cell JSON:            ${mb.toFixed(1)} MB uncompressed ` +
        `(~${(totals.cellBytes / totals.ok / 1024).toFixed(1)} KB/page)`,
    );
  }

  if (unsupportedSizes.size > 0) {
    console.log('\n  render sizes with no profile yet:');
    for (const [size, count] of [...unsupportedSizes].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${size}: ${count} captures`);
    }
    console.log(
      '  These are catalogued and browsable; they need a render profile and\n' +
        '  glyph atlas before they can be published. See the spec.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
