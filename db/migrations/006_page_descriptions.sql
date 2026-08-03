-- Page descriptions in the backup.
--
-- A description used to live only on a publication record, so only archive
-- pages could have one. The management screen now covers every page on air,
-- including the ones people made by hand, so descriptions moved to playhtml
-- beside titles — which makes them the sort of thing `live_pages` exists to
-- protect: content owned by a third-party store with no export.
--
-- `published_pages.description` stays as provenance: what a page was published
-- with, as opposed to what it says now.
alter table live_pages
  add column if not exists description text not null default '';
