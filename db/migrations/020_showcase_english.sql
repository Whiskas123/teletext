-- The front-page strip in English.
--
-- A strip picture is drawn once, in the moderator's browser, from the page's
-- cells — so it is Portuguese, and /en showed Portuguese pages under English
-- copy. The English picture is drawn at the same moment from the page's stored
-- translation (what the EN key shows) and kept beside it, with the English
-- title for the caption. Null when the screen had no translation when it was
-- drawn: the strip then shows the Portuguese, as the EN key would.
alter table showcase_pages
  add column if not exists image_en bytea,
  add column if not exists title_en text not null default '' check (length(title_en) <= 60);
