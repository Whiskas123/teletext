-- Where each screen came from, carried in the live copy.
--
-- Which capture is on which screen used to live only in `published_pages`, a
-- second map of the service keyed by page number and kept in step with playhtml
-- by hand. It now lives in playhtml beside the screen (`page-sources`, see
-- src/domain/pageSource.ts), so a renumbering moves both in one write; the live
-- mirror copies it here with everything else.
--
-- `published_pages` is left as history: read by /manage to move its records into
-- playhtml, and no longer written except to mark a record as dealt with.

alter table live_pages
  add column if not exists source jsonb;

comment on column live_pages.source is
  'Where this screen came from, as the page-sources channel holds it: capture '
  'id, transforms and capture details. Null for a screen made by hand.';

-- "Is this capture already on air?" is asked of every row of the archive
-- browser; an expression index keeps it a lookup.
create index if not exists live_pages_source_capture_idx
  on live_pages (((source ->> 'captureId')::bigint));

-- Records moved into playhtml, restored or discarded are marked rather than
-- deleted, so the table keeps its history and stops offering them.
alter table published_pages
  add column if not exists resolved_at timestamptz;
