-- Store the actual render of each capture, and drop the palette thumbnail.
--
-- The thumbnail was one palette colour per cell, drawn to a 40x24 canvas. The
-- reasoning was that a page is recognisable by layout and colour before it is
-- readable — which is true of a graphics-heavy page and false of almost every
-- page in this archive, because teletext is mostly text. Reducing a cell to one
-- colour throws away the glyph, and a page of text became a smear of dots.
--
-- The source images are the obvious answer and were only ever unavailable
-- because the corpus is gitignored and never deployed. Storing them fixes that,
-- and costs less than expected: re-encoded as lossless WebP they average 2.2 KB
-- against 5.6 KB as the original GIF/PNG — about 7 MB for all 3,148 captures.
-- Lossless, so what is shown is exactly what was decoded.
--
-- (Lossy WebP was measured too, at 18 KB average — three times *larger*.
-- Photographic compression has nothing to work with on flat colour and hard
-- edges, and would have blurred the very glyphs this is meant to restore.)

alter table archive_captures
  add column if not exists image bytea;

-- Kept as a column rather than assumed, so a future import could store
-- something else without a migration to find out what is in here.
alter table archive_captures
  add column if not exists image_type text not null default 'image/webp';

-- Partial index: the admin browser's default view is captures it can show.
create index if not exists archive_captures_has_image_idx
  on archive_captures (source, original_page)
  where image is not null;

alter table archive_captures
  drop constraint if exists archive_captures_thumbnail_check;

alter table archive_captures
  drop column if exists thumbnail;
