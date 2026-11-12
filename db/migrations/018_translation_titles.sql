-- The page's title in English, for the Yellow Pages in English.
--
-- Kept on the screen's translation row, made by the same Translate press, so it
-- moves with the screen when /manage renumbers (`?subs-move`). Like the runs,
-- `title_pt` is the title it was made from: the English applies only while the
-- page is still called that.

alter table page_translations
  add column if not exists title_pt text,
  add column if not exists title_en text;
