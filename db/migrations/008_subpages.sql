-- Subpages: the several screens one page number holds.
--
-- Broadcast teletext had no way to make a page longer than 40x24, so a page
-- with more to say was sent as a carousel — 220-1, 220-2, 220-3, each a whole
-- page. The corpus already records this: `archive_captures.sub` is exactly that
-- number, and `571-0002` is the second screen of page 571 rather than a second
-- page. Until now the publication map had nowhere to put it, so a capture's
-- subpage was information the archive held and the site threw away.
--
-- Two tables gain the same column and the same shape of key.
--
-- ## published_pages
--
-- `page_number` was the primary key, which is why one page could hold one
-- capture. The key becomes (page_number, subpage): publishing 571-0002 to
-- subpage 2 of page 220 is now a distinct row from whatever is on subpage 1.
-- Everything that renumbers pages still works on `page_number` alone, so a move
-- carries a page's whole carousel without knowing it exists — which is the
-- behaviour you want, since the subpages of a page are the page.
--
-- ## live_pages
--
-- The backup. This one is not optional: subpages live in playhtml like every
-- other page, playhtml is a third-party store with no export, and a `live_pages`
-- keyed by page number alone would silently back up screen 1 of every carousel
-- and drop the rest. A restore would then look successful and quietly be
-- missing content.
--
-- Existing rows are subpage 1 by default, which is what they are: every page in
-- both tables today is the first screen of a carousel of one.

-- ---------------------------------------------------------------------------
-- published_pages
-- ---------------------------------------------------------------------------
alter table published_pages
  add column if not exists subpage integer not null default 1
    check (subpage between 1 and 26);

comment on column published_pages.subpage is
  'Which screen of the page carousel this capture is published to. 1 is the '
  'page itself. Bounded to match MAX_SUBPAGE in src/domain/subpages.ts.';

do $$
begin
  -- Named by lookup rather than assumed: 001 declared the key inline, so the
  -- constraint name is whatever Postgres generated for it.
  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'published_pages'
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
  ) then
    execute (
      select format('alter table published_pages drop constraint %I', con.conname)
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      where rel.relname = 'published_pages' and con.contype = 'p'
    );
    alter table published_pages
      add constraint published_pages_pkey primary key (page_number, subpage);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- live_pages
-- ---------------------------------------------------------------------------
alter table live_pages
  add column if not exists subpage integer not null default 1
    check (subpage between 1 and 26);

comment on column live_pages.subpage is
  'Which screen of the page carousel this row backs up. Without it the backup '
  'would hold screen 1 of every carousel and silently lose the rest.';

do $$
begin
  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'live_pages'
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
  ) then
    execute (
      select format('alter table live_pages drop constraint %I', con.conname)
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      where rel.relname = 'live_pages' and con.contype = 'p'
    );
    alter table live_pages
      add constraint live_pages_pkey primary key (page_number, subpage);
  end if;
end
$$;

-- How many subpages each page holds, so a restore brings the carousels back and
-- not just their contents.
--
-- Stored rather than derived from `max(subpage)`, mirroring the live document
-- (see src/collab/useSubpages.ts): playhtml cannot delete a key, so removing a
-- subpage only blanks its cells and the key stays — a derived count could rise
-- and never fall. `live_pages` is a copy of that document, and a copy that
-- disagrees with it about how many screens a page has is not a copy.
--
-- The value repeats across a page's rows, which is redundancy that cannot
-- diverge: all of a page's rows are written from one map in one statement, and
-- a restore reads the count per page rather than per row.
alter table live_pages
  add column if not exists subpage_count integer not null default 1
    check (subpage_count between 1 and 26);
