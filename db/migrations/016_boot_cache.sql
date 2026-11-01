-- The boot pages, compressed, so a read does not pull all of `live_pages` out
-- of Neon (api/_lib/bootCache.ts). One row, replaced when the pages change.
--
-- `body` is base64 in text rather than bytea: the HTTP driver returns bytea as
-- hex, twice the bytes, and these bytes are what this table exists to save.

create table if not exists boot_cache (
  id      boolean primary key default true check (id),
  version text    not null,
  body    text    not null
);
