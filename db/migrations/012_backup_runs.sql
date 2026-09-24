-- Each daily read of the live document, and how it went.
--
-- The daily job reads the playhtml document from the server
-- (api/_lib/liveDocument.ts) and copies what changed into live_pages, so the
-- playground's edits are backed up even when no moderator's browser is open.
-- That read depends on playhtml internals that can change without notice, so a
-- failure has to be visible: /manage reads the latest row and says when the
-- daily read failed or has not run, rather than a quiet backup going stale.

create table if not exists backup_runs (
  id       bigserial   primary key,
  ran_at   timestamptz not null default now(),
  ok       boolean     not null,
  -- Screens written; the job never deletes.
  stored   integer     not null default 0,
  -- Pages gone from the live document but still in the copy, left for the
  -- moderator mirror to remove with confirmation.
  lingering integer    not null default 0,
  -- Size of the document read, to notice it growing towards the time limit.
  bytes    integer,
  ms       integer,
  detail   text
);

create index if not exists backup_runs_ran_at_idx on backup_runs (ran_at desc);
