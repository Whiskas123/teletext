/**
 * Tests for the two-manifest normalisation.
 *
 * The fixtures are real entries copied out of the two corpus manifests, chosen
 * for the cases that actually differ between them rather than for coverage: an
 * RTP entry with `tier`, `superseded` and `title`, a SIC entry with `bucket`
 * and no title at all, a nested `eventos` topic, a multi-timestamp capture, and
 * a SIC page beyond the publishable range.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeManifestEntry,
  parseArchiveTimestamp,
  readManifest,
  relocateCapture,
  topicFromPath,
  topicGroupOf,
} from './archiveManifest';

/** RTP: gif3 tier, superseded copies, a title, one timestamp. */
const RTP_ENTRY = {
  tier: 'gif3',
  page: '100',
  sub: '01',
  digest: '56JWL73JSG3AJ57SWF6JSZJHRDBKOJPK',
  url: 'http://www.rtp.pt:80/teletexto/gif3/images/100-01.gif',
  mime: 'image/gif',
  timestamps: ['19980615082028'],
  file: 'indice/100-01_19980615082028.gif',
  bytes: 12526,
  width: 520,
  height: 400,
  native: true,
  source_file: 'gif3/100-01_19980615082028.gif',
  topic: 'indice',
  scheme: '1998-2000',
  superseded: [
    { tier: 'gif2', timestamp: '19980615080756', width: 400, height: 300 },
    { tier: 'gif1', timestamp: '19980615082422', width: 320, height: 250 },
  ],
  title: 'Edição Nº 531  -  15 Junho 1998',
  decided_by: 'header',
};

/** SIC: bucket instead of tier, no title field, four-digit sub. */
const SIC_ENTRY = {
  bucket: '100',
  page: '100',
  sub: '0001',
  digest: 'ABCDEF0123456789ABCDEF0123456789ABCDEFGH',
  url: 'http://teletexto.sic.pt/100-0001.png',
  mime: 'image/png',
  timestamps: ['20080311223107', '20100813170520'],
  file: 'televisao/100-0001_20080311223107.png',
  bytes: 8214,
  width: 480,
  height: 375,
  native: true,
  source_file: 'png/100-0001_20080311223107.png',
  topic: 'televisao',
  scheme: '2006-2010',
  decided_by: 'page-band',
};

describe('parseArchiveTimestamp', () => {
  it('reads YYYYMMDDHHMMSS as UTC', () => {
    const date = parseArchiveTimestamp('19980615082028');
    expect(date?.toISOString()).toBe('1998-06-15T08:20:28.000Z');
  });

  it('rejects anything that is not exactly fourteen digits', () => {
    for (const bad of ['', '1998', '199806150820281', 'not-a-date', null, 42]) {
      expect(parseArchiveTimestamp(bad)).toBeNull();
    }
  });

  it('rejects digits that do not describe a real instant', () => {
    // Date would roll each of these over into a different, plausible-looking
    // day rather than reporting it as wrong.
    expect(parseArchiveTimestamp('19981315082028')).toBeNull(); // month 13
    expect(parseArchiveTimestamp('19980632082028')).toBeNull(); // day 32
    expect(parseArchiveTimestamp('19980615252028')).toBeNull(); // hour 25
  });
});

describe('topicGroupOf', () => {
  it('takes the leading segment of a nested topic', () => {
    expect(topicGroupOf('eventos/expo-98')).toBe('eventos');
    expect(topicGroupOf('eventos/porto-2001-capital-cultura')).toBe('eventos');
  });

  it('returns a flat topic unchanged', () => {
    expect(topicGroupOf('noticias')).toBe('noticias');
  });

  it('has no group for an absent topic', () => {
    expect(topicGroupOf(null)).toBeNull();
    expect(topicGroupOf('')).toBeNull();
  });
});

describe('normalizeManifestEntry', () => {
  it('keeps tier for RTP and leaves bucket unset', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    expect(record?.tier).toBe('gif3');
    expect(record?.bucket).toBeNull();
  });

  it('keeps bucket for SIC and leaves tier unset', () => {
    const record = normalizeManifestEntry('sic', SIC_ENTRY);
    expect(record?.bucket).toBe('100');
    expect(record?.tier).toBeNull();
  });

  it('never reads a tier off a SIC entry, even if one is present', () => {
    // The two fields sit in the same slot but mean unrelated things; a stray
    // `tier` on a SIC entry must not be read as a resolution.
    const record = normalizeManifestEntry('sic', { ...SIC_ENTRY, tier: 'gif3' });
    expect(record?.tier).toBeNull();
  });

  it('parses both sub label widths to the same index', () => {
    const rtp = normalizeManifestEntry('rtp', RTP_ENTRY);
    const sic = normalizeManifestEntry('sic', SIC_ENTRY);
    expect(rtp?.sub).toBe('01');
    expect(sic?.sub).toBe('0001');
    expect(rtp?.subIndex).toBe(1);
    expect(sic?.subIndex).toBe(1);
  });

  it('records the full span of a multi-day capture, not just the first day', () => {
    const record = normalizeManifestEntry('sic', SIC_ENTRY);
    expect(record?.captureCount).toBe(2);
    expect(record?.firstSeen?.toISOString()).toBe('2008-03-11T22:31:07.000Z');
    expect(record?.lastSeen?.toISOString()).toBe('2010-08-13T17:05:20.000Z');
  });

  it('orders timestamps regardless of the order the manifest lists them', () => {
    const record = normalizeManifestEntry('sic', {
      ...SIC_ENTRY,
      timestamps: ['20100813170520', '20080311223107'],
    });
    expect(record?.firstSeen?.toISOString()).toBe('2008-03-11T22:31:07.000Z');
    expect(record?.lastSeen?.toISOString()).toBe('2010-08-13T17:05:20.000Z');
  });

  it('counts a capture with no usable timestamp as seen once', () => {
    const record = normalizeManifestEntry('rtp', { ...RTP_ENTRY, timestamps: [] });
    expect(record?.captureCount).toBe(1);
    expect(record?.firstSeen).toBeNull();
  });

  it('splits a nested topic into topic and group', () => {
    const record = normalizeManifestEntry('rtp', {
      ...RTP_ENTRY,
      topic: 'eventos/expo-98',
    });
    expect(record?.topic).toBe('eventos/expo-98');
    expect(record?.topicGroup).toBe('eventos');
  });

  it('has no title for a SIC entry, which carries no such field', () => {
    expect(normalizeManifestEntry('sic', SIC_ENTRY)?.manifestTitle).toBeNull();
  });

  it('tolerates an RTP entry whose title is explicitly null', () => {
    const record = normalizeManifestEntry('rtp', { ...RTP_ENTRY, title: null });
    expect(record?.manifestTitle).toBeNull();
    expect(record?.digest).toBe(RTP_ENTRY.digest);
  });

  it('keeps a page number beyond the publishable range', () => {
    // SIC ran pages up to 885. The corpus records what aired; only
    // published_pages is limited to 100..699.
    const record = normalizeManifestEntry('sic', { ...SIC_ENTRY, page: '885' });
    expect(record?.originalPage).toBe(885);
  });

  it('keeps corpus_file and source_file apart', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    // corpusFile locates the image now; sourceFile is where it came from.
    expect(record?.corpusFile).toBe('indice/100-01_19980615082028.gif');
    expect(record?.sourceFile).toBe('gif3/100-01_19980615082028.gif');
  });

  it('drops superseded copies', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    expect(record).not.toHaveProperty('superseded');
  });

  it('rejects an entry missing what makes it resolvable', () => {
    expect(normalizeManifestEntry('rtp', { ...RTP_ENTRY, page: 'abc' })).toBeNull();
    expect(normalizeManifestEntry('rtp', { ...RTP_ENTRY, digest: '' })).toBeNull();
    expect(normalizeManifestEntry('rtp', { ...RTP_ENTRY, file: '' })).toBeNull();
    expect(normalizeManifestEntry('rtp', { ...RTP_ENTRY, width: null })).toBeNull();
    expect(normalizeManifestEntry('rtp', null)).toBeNull();
    expect(normalizeManifestEntry('rtp', 'nope')).toBeNull();
  });
});

describe('readManifest', () => {
  it('normalises every usable entry', () => {
    const result = readManifest('rtp', {
      images_index: [RTP_ENTRY, { ...RTP_ENTRY, digest: 'OTHER', sub: '02' }],
    });
    expect(result.captures).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('collapses a digest repeated within one manifest', () => {
    // The unique (source, digest) constraint would otherwise fail the import
    // over a duplicate that costs us nothing to drop.
    const result = readManifest('rtp', { images_index: [RTP_ENTRY, RTP_ENTRY] });
    expect(result.captures).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('counts unusable entries instead of failing the batch', () => {
    const result = readManifest('rtp', {
      images_index: [RTP_ENTRY, { ...RTP_ENTRY, digest: 'X', page: 'not-a-page' }],
    });
    expect(result.captures).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('handles a manifest with no index', () => {
    expect(readManifest('rtp', {})).toEqual({ captures: [], skipped: 0 });
    expect(readManifest('rtp', { images_index: 'nope' })).toEqual({
      captures: [],
      skipped: 0,
    });
  });
});

describe('capture counting against real corpus quirks', () => {
  it('counts distinct days, not repeated timestamp entries', () => {
    // Verbatim from archive-corpus-rtp: RTP repeats each instant once per
    // resolution tier, so nine entries describe three days.
    const record = normalizeManifestEntry('rtp', {
      ...RTP_ENTRY,
      timestamps: [
        '20000908070849', '20000908070849', '20000908070849',
        '20000910073925', '20000910073925', '20000910073925',
        '20000926013859', '20000926013859', '20000926013859',
      ],
    });
    expect(record?.captureCount).toBe(3);
    expect(record?.firstSeen?.toISOString()).toBe('2000-09-08T07:08:49.000Z');
    expect(record?.lastSeen?.toISOString()).toBe('2000-09-26T01:38:59.000Z');
  });
});

describe('relocateCapture', () => {
  it('takes the topic from the folder the image is actually in', () => {
    // The RTP corpus was re-filed by hand after its manifest was written; the
    // folder is the newer, curated answer and must win.
    const record = normalizeManifestEntry('rtp', {
      ...RTP_ENTRY,
      topic: 'publicidade',
      file: 'publicidade/100-01_19980615082028.gif',
    });
    const moved = relocateCapture(record!, 'indice/100-01_19980615082028.gif');
    expect(moved.topic).toBe('indice');
    expect(moved.topicGroup).toBe('indice');
    expect(moved.corpusFile).toBe('indice/100-01_19980615082028.gif');
    expect(moved.topicSource).toBe('folder');
  });

  it('recognises a folder the manifest has no concept of', () => {
    // 70 RTP captures moved from utilidades into a horoscopo folder that does
    // not appear anywhere in the manifest's topic list.
    const record = normalizeManifestEntry('rtp', {
      ...RTP_ENTRY,
      topic: 'utilidades',
    });
    const moved = relocateCapture(record!, 'horoscopo/430-01_19990101000000.gif');
    expect(moved.topic).toBe('horoscopo');
    expect(moved.topicSource).toBe('folder');
  });

  it('keeps nesting when relocating into a nested topic', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    const moved = relocateCapture(record!, 'eventos/expo-98/163-01_1998.gif');
    expect(moved.topic).toBe('eventos/expo-98');
    expect(moved.topicGroup).toBe('eventos');
  });

  it('reports manifest as the source when folder and manifest agree', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    const moved = relocateCapture(record!, 'indice/100-01_19980615082028.gif');
    expect(moved.topic).toBe('indice');
    expect(moved.topicSource).toBe('manifest');
  });

  it('leaves the classifier note alone — it explains a superseded answer', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    const moved = relocateCapture(record!, 'horoscopo/100-01.gif');
    expect(moved.topicDecidedBy).toBe('header');
  });

  it('falls back to the manifest topic for a file at the corpus root', () => {
    const record = normalizeManifestEntry('rtp', RTP_ENTRY);
    const moved = relocateCapture(record!, 'stray.gif');
    expect(moved.topic).toBe('indice');
  });
});

describe('topicFromPath', () => {
  it('reads the folder, keeping nesting', () => {
    expect(topicFromPath('noticias/101-01.gif')).toBe('noticias');
    expect(topicFromPath('eventos/expo-98/163-01.gif')).toBe('eventos/expo-98');
  });

  it('has no topic for a bare filename', () => {
    expect(topicFromPath('163-01.gif')).toBeNull();
  });
});
