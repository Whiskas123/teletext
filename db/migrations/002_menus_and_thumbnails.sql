-- Publication transforms and archive thumbnails.
--
-- Adds what the management screen needs to be usable at archive scale: a
-- picture of every capture in the browser, and the two adjustments a capture
-- commonly needs on the way to being published.

-- ---------------------------------------------------------------------------
-- custom_menus — reusable four-colour fastext strips.
--
-- The strip along the bottom of a teletext page is four coloured labels, each
-- a jump to another page. Captures arrive with whatever strip they were
-- broadcast with, pointing at page numbers that mean nothing in this archive,
-- so publishing usually replaces it. The same strip goes on dozens of pages,
-- which is why they are named and kept rather than retyped.
-- ---------------------------------------------------------------------------
create table if not exists custom_menus (
  id         bigserial   primary key,
  name       text        not null check (length(trim(name)) between 1 and 40),
  -- Four slots of { label, pageNumber }, validated by src/domain/menu.ts.
  -- Stored whole because it is only ever read and written as a unit.
  items      jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

-- ---------------------------------------------------------------------------
-- published_pages — record the transforms, not just the result.
--
-- The cells that go live are derived: capture, optionally shifted, optionally
-- with a menu written over the last row. Storing the inputs rather than only
-- the output means a menu can be edited and re-applied to every page using it,
-- and a publication can be reproduced or explained later.
-- ---------------------------------------------------------------------------
alter table published_pages
  add column if not exists shift_down boolean not null default false;

alter table published_pages
  add column if not exists menu_id bigint references custom_menus (id) on delete set null;

create index if not exists published_pages_menu_idx on published_pages (menu_id);

comment on column published_pages.shift_down is
  'Move every row down one, dropping the last. Removes a duplicate menu strip '
  'and re-aligns captures whose renderer had no header row to give up.';

-- ---------------------------------------------------------------------------
-- archive_captures.thumbnail — one palette digit per cell, 960 characters.
--
-- The browser shows sixty captures at once. Their full cells are ~59 KB each,
-- so drawing real pages would be megabytes per screen; this is ~1.6% of that
-- and enough to recognise a page by its layout and colour. Written at import
-- (scripts/importCorpus.ts) and backfillable (scripts/backfillThumbnails.ts).
-- ---------------------------------------------------------------------------
-- The length is checked with `length()` rather than a `{960}` repetition:
-- Postgres's regex engine caps bounded repetition at 255 and rejects anything
-- larger. 003 repairs databases that already ran the original form.
alter table archive_captures
  add column if not exists thumbnail text
    check (
      thumbnail is null
      or (length(thumbnail) = 960 and thumbnail ~ '^[0-7]+$')
    );
