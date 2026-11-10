-- Earlier versions of playground screens.
--
-- `live_pages` holds one row per screen and every backup overwrites it. A page
-- deleted from the live document survives there (the backup never deletes),
-- but a page *drawn over* does not: the next backup copies the junk on top of
-- the good version. Backing up every half hour made that window shorter, not
-- safer.
--
-- So before a playground row (700..999) is changed or deleted, a trigger keeps
-- the row as it was. Done in the database rather than in `writeRows` so every
-- path that writes `live_pages` — the half-hourly read, a moderator's mirror,
-- a manual backup, SQL — is covered by the same rule.
--
-- A history row holds what the screen was from its `updated_at` until
-- `replaced_at`, so "the playground as it was at T" is every screen whose
-- interval contains T (`bun run db:restore --at <time>`).
--
-- Only the playground: the archive (100..699) is written by a moderator alone
-- and can be re-published from the corpus, while visitors' pages exist nowhere
-- else. Kept for 30 days, swept by the trigger itself so no job is needed.
-- Known ceiling: a moderator's mirror writes a version each time a page being
-- drawn settles, so a page drawn while /manage is open can collect hundreds of
-- versions; at ~10 KB compressed each that is still small.

create table if not exists live_pages_history (
  id            bigserial   primary key,
  page_number   integer     not null,
  subpage       integer     not null,
  subpage_count integer     not null,
  cells         jsonb       not null,
  title         text        not null,
  kind          text        not null,
  description   text        not null,
  source        jsonb,
  updated_at    timestamptz not null,
  replaced_at   timestamptz not null default now(),
  -- 'update' or 'delete': what happened to the row at `replaced_at`.
  replaced_by   text        not null check (replaced_by in ('update', 'delete'))
);

create index if not exists live_pages_history_screen_idx
  on live_pages_history (page_number, subpage, replaced_at desc);
create index if not exists live_pages_history_replaced_idx
  on live_pages_history (replaced_at);

create or replace function keep_playground_version() returns trigger
language plpgsql as $$
begin
  if old.page_number < 700 then
    return null;
  end if;
  -- A backup that rewrites a row with the same content (a new digest, a fresh
  -- `updated_at`) is not a new version.
  if tg_op = 'UPDATE'
     and (old.cells, old.title, old.kind, old.description, old.subpage_count)
         is not distinct from
         (new.cells, new.title, new.kind, new.description, new.subpage_count) then
    return null;
  end if;
  insert into live_pages_history
    (page_number, subpage, subpage_count, cells, title, kind, description, source, updated_at, replaced_by)
  values
    (old.page_number, old.subpage, old.subpage_count, old.cells, old.title, old.kind,
     old.description, old.source, old.updated_at, lower(tg_op));
  delete from live_pages_history where replaced_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists live_pages_keep_playground_version on live_pages;
create trigger live_pages_keep_playground_version
  after update or delete on live_pages
  for each row execute function keep_playground_version();
