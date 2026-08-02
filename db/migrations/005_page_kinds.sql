-- Directory role for each page, so the backup covers it.
--
-- The Yellow Pages directory is a tree: categories, subcategories, and the
-- pages beneath them. The shape is derived from page-number order plus a kind
-- per page (see src/domain/directory.ts), and the kinds live in playhtml —
-- because the directory is a public read path that must not depend on this
-- database, and because it applies to hand-made pages too, which exist only in
-- the live document.
--
-- That makes them exactly the kind of thing `live_pages` exists to protect:
-- content owned by a third-party store with no export. Without this column a
-- restore would bring back every page and every title, and silently flatten the
-- directory.
alter table live_pages
  add column if not exists kind text not null default 'page'
    check (kind in ('category', 'subcategory', 'page'));
