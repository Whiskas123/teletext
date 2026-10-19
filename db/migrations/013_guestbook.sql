-- The guestbook's signatures, one row each.
--
-- They lived in the shared playhtml document until October 2026, when that
-- document grew too large for playhtml's server to open and every signature
-- in it became unreachable. A signature is written once and never edited, so
-- it needs nothing playhtml offers; here it is backed up with everything else.
--
-- `cells` holds only the snippet's non-empty cells, keyed by index
-- (`compactSnippet` in src/domain/guestbook.ts); readers fill in the rest.

create table if not exists guestbook_entries (
  id         text        primary key,
  name       text        not null,
  author_id  text        not null default '',
  cells      jsonb       not null,
  -- When it was signed, epoch milliseconds, as the entry has always carried.
  ts         bigint      not null,
  created_at timestamptz not null default now()
);

create index if not exists guestbook_entries_ts_idx on guestbook_entries (ts desc);
create index if not exists guestbook_entries_author_idx on guestbook_entries (author_id, created_at desc);
