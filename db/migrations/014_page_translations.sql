-- English for curated pages, one row per screen, for the EN key.
--
-- `runs` is a list of `{ row, col, pt, en }` (SubtitleEntry in
-- src/domain/subtitles.ts): where a run of text sits, the Portuguese it said
-- when it was translated, and the English. Readers use an entry only while the
-- page still says `pt` there, so a page edited after translation needs no
-- cleanup here: the stale part simply stops applying, and /manage shows the
-- page as partly translated until someone translates it again.
--
-- Keyed like live_pages, but not tied to it by a foreign key: renumbering a
-- page moves its live row, and a translation left at the old number is
-- harmless — it matches nothing there.

create table if not exists page_translations (
  page_number integer     not null,
  subpage     integer     not null default 1,
  runs        jsonb       not null,
  -- Which model wrote it, or 'hand' for the ones made by hand.
  model       text        not null,
  updated_at  timestamptz not null default now(),
  primary key (page_number, subpage)
);
