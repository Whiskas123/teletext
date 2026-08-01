-- Archive database: corpus, publication map, live-page snapshots, glyph atlas.
--
-- See .kiro/specs/archive-database/design.md for the reasoning behind the
-- shape of these tables.

-- ---------------------------------------------------------------------------
-- archive_captures — the corpus. ~3,190 rows, written by scripts/importCorpus.ts.
--
-- A page number is NOT a version key. Broadcasters reused numbers for entirely
-- different content across the years, so the several captures sharing a number
-- are usually unrelated pages rather than revisions of one. Everything that
-- helps choose between them — topic, era, how long it was on air — is kept.
-- ---------------------------------------------------------------------------
create table if not exists archive_captures (
  id                  bigserial primary key,
  source              text        not null check (source in ('rtp', 'sic')),

  -- The broadcast page number. NOT constrained to the publishable 100..699
  -- range: SIC ran pages up to 885, and the corpus records what was aired.
  original_page       integer     not null,
  -- Raw subpage label, kept verbatim because the two corpora disagree on
  -- width: RTP writes '01', SIC writes '0001'. sub_index is the parsed form,
  -- for ordering.
  sub                 text        not null,
  sub_index           integer,

  digest              text        not null,
  source_url          text,
  -- Path within archive-corpus-<source>/, i.e. the manifest's `file`. This is
  -- the one needed to find the image again and re-decode it.
  corpus_file         text        not null,
  -- Path in the original Arquivo.pt dump (`source_file`). Provenance only.
  source_file         text,
  bytes               integer,
  -- Whether the capture is at the renderer's native resolution rather than an
  -- upscale; a quality signal when choosing between candidates.
  native              boolean,

  -- Selection metadata.
  --
  -- `topic` is the folder the image is filed under, which is the curated
  -- division the archive is browsed by. It is not always the manifest's own
  -- `topic`: the RTP corpus was re-filed by hand afterwards, moving 236
  -- captures — 70 of them into a `horoscopo` folder the manifest never knew
  -- about. `topic_source` records which of the two a row's topic came from.
  topic               text,
  topic_group         text,
  topic_decided_by    text,
  topic_source        text not null default 'manifest'
                        check (topic_source in ('folder', 'manifest')),
  scheme              text,
  first_seen          timestamptz,
  last_seen           timestamptz,
  capture_count       integer     not null default 1,

  -- Source-specific: these occupy the same slot in the two manifests but mean
  -- unrelated things (RTP resolution tier vs. SIC page hundred-band).
  tier                text,
  bucket              text,

  manifest_title      text,

  -- Decode outputs.
  --
  -- `cells` is nullable so that a capture can be catalogued whether or not it
  -- can be decoded. Every capture in the corpus decodes today, so in practice
  -- decode_status is always 'ok' — but the column stays: it is what let SIC be
  -- browsable while its render profiles were still missing, and it is what a
  -- newly added render size would need again.
  decode_status       text        not null default 'ok'
                        check (decode_status in ('ok', 'unsupported-profile', 'failed')),
  decode_detail       text,
  profile             text,
  width               integer     not null,
  height              integer     not null,
  cells               jsonb,
  dropped_row         text        check (dropped_row in ('first', 'last')),
  dropped_had_content boolean     not null default false,
  snapped_pixels      integer     not null default 0,
  unknown_glyphs      integer     not null default 0,

  imported_at         timestamptz not null default now(),

  unique (source, digest),
  -- A decoded capture must actually carry cells, and an undecoded one must not
  -- pretend to: the publish path selects on decode_status and would otherwise
  -- have to re-check the payload.
  constraint archive_captures_cells_match_status check (
    (decode_status = 'ok' and cells is not null and profile is not null)
    or (decode_status <> 'ok' and cells is null)
  )
);

create index if not exists archive_captures_status_idx
  on archive_captures (decode_status);

create index if not exists archive_captures_page_idx
  on archive_captures (source, original_page, sub);
create index if not exists archive_captures_topic_idx
  on archive_captures (topic);
create index if not exists archive_captures_topic_group_idx
  on archive_captures (topic_group);
create index if not exists archive_captures_scheme_idx
  on archive_captures (scheme);
-- The admin browser defaults to captures that are actually publishable; keep
-- that path off a seq scan.
create index if not exists archive_captures_clean_idx
  on archive_captures (source, original_page)
  where decode_status = 'ok' and snapped_pixels = 0 and unknown_glyphs = 0;

-- ---------------------------------------------------------------------------
-- published_pages — what is live, and where.
--
-- Constrained to the archive range: 700..999 is the open playground
-- (src/domain/access.ts) and is never published to from the corpus.
-- ---------------------------------------------------------------------------
create table if not exists published_pages (
  page_number  integer     primary key check (page_number between 100 and 699),
  capture_id   bigint      not null references archive_captures (id) on delete restrict,
  title        text        not null default '' check (length(title) <= 60),
  description  text        not null default '' check (length(description) <= 500),
  published_at timestamptz not null default now(),
  published_by text
);

create index if not exists published_pages_capture_idx
  on published_pages (capture_id);

-- ---------------------------------------------------------------------------
-- live_pages — backup of the playhtml document.
--
-- Full 1..999 range on purpose: the playground pages are visitors' own work and
-- are the content that most needs backing up. Overwritten by the snapshot job.
-- ---------------------------------------------------------------------------
create table if not exists live_pages (
  page_number integer     primary key check (page_number between 1 and 999),
  cells       jsonb       not null,
  title       text        not null default '',
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- learned_glyphs — characters taught on the import screen.
--
-- Previously confined to one browser's localStorage, which meant every
-- character taught existed on exactly one machine. The key pattern matches the
-- validation the client already applies: this feeds a decoder, so it stays
-- checked on both sides.
-- ---------------------------------------------------------------------------
create table if not exists learned_glyphs (
  glyph_key text        primary key check (glyph_key ~ '^[0-9a-f]{16,80}$'),
  character text        not null check (length(character) > 0),
  taught_at timestamptz not null default now()
);
