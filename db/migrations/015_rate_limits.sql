-- Who is asking, for the two limits that need to know.
--
-- `client` is the request's address keyed with SESSION_SECRET (`clientKey` in
-- api/_lib/http.ts): the same address always gives the same value, and the
-- value cannot be turned back into the address.
--
-- The guestbook's own limit was keyed on `author_id`, which the browser sends,
-- so a script could sign as fast as it liked by sending a new one each time.

alter table guestbook_entries add column if not exists client text not null default '';
create index if not exists guestbook_entries_client_idx on guestbook_entries (client, created_at desc);

-- Wrong admin passwords, kept for one window (api/auth.ts) and swept as new
-- ones arrive.
create table if not exists login_failures (
  client    text        not null,
  failed_at timestamptz not null default now()
);
create index if not exists login_failures_client_idx on login_failures (client, failed_at desc);
