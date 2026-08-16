-- The pages chosen for the front page, and a picture of each.
--
-- The strip under the wordmark used to show whatever the live document held, in
-- page order, drawn to a canvas on every visit. Two things were wrong with
-- that. It was not a *choice* — the front page showed page 100 because 100 is
-- the lowest number, not because it is worth showing. And every visitor's
-- browser redrew a dozen pages from cells to pixels, work that produces the
-- same image every time.
--
-- Both are the same fix: a moderator picks the pages, and the picture is made
-- once, at that moment, and stored.
--
-- ## Why the image lives here
--
-- The same reasoning as `archive_captures.image` (004): the bytes are small,
-- they never change once written, and the alternative is regenerating them
-- forever. A page is 560x432; as a PNG that is a few kilobytes of flat colour.
--
-- It is *not* derivable on the server: a page's cells live in playhtml, which
-- only a connected browser can read, so the picture is drawn client-side and
-- uploaded — the same split as publishing (see api/published.ts).
--
-- ## Position, not page number, is the order
--
-- The strip is a running order, and the order a curator wants is not usually
-- ascending page number: it is the good-looking one first. `position` carries
-- that, so the front page reads the strip as chosen rather than as sorted.
create table if not exists showcase_pages (
  page_number integer     not null check (page_number between 100 and 999),
  subpage     integer     not null default 1 check (subpage between 1 and 26),
  -- Where it sits in the strip. Not unique: two pages briefly sharing a
  -- position during a reorder is a display detail, not a corruption.
  position    integer     not null default 0,
  -- The picture, drawn from the page's cells at the moment it was chosen.
  image       bytea       not null,
  image_type  text        not null default 'image/png',
  -- The title as it was when chosen, so the strip can caption a page without
  -- reading the live document. Provenance, like published_pages.title.
  title       text        not null default '' check (length(title) <= 60),
  updated_at  timestamptz not null default now(),

  primary key (page_number, subpage)
);

-- The front page reads the whole strip in order, and only that.
create index if not exists showcase_pages_position_idx
  on showcase_pages (position, page_number, subpage);
