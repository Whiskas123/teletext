-- A third heading level in the Yellow Pages directory.
--
-- `live_pages.kind` was CHECKed to the two heading levels the directory started
-- with. The directory is a tree read off page-number order (see
-- src/domain/directory.ts), and a third level is a listing rule rather than a
-- schema change — but the backup stores the kind, so the constraint has to know
-- about it or a snapshot of a page marked `subsubcategory` would be rejected and
-- the page would come back from a restore with its heading flattened.
--
-- Dropped and re-added rather than altered: Postgres has no
-- `alter constraint ... check`, and the column keeps its rows either way.
alter table live_pages
  drop constraint if exists live_pages_kind_check;

alter table live_pages
  add constraint live_pages_kind_check
    check (kind in ('category', 'subcategory', 'subsubcategory', 'page'));
