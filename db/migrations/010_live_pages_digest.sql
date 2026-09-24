-- live_pages follows playhtml continuously.
--
-- It used to be refreshed only when a moderator pressed "Back up now", and
-- never lost a row: pages removed from the service lived on in the backup and
-- in the fallback built from it. A signed-in moderator's browser now mirrors
-- every change within seconds (src/collab/liveMirror.ts), sending only what
-- changed — which needs a fingerprint of what each row holds, so the browser
-- can compare without downloading every page.
--
-- The fingerprint is computed by the browser (src/domain/liveMirror.ts) and
-- stored as given. A row without one — written before this, or by the manual
-- backup — simply counts as changed and is sent again once.

alter table live_pages
  add column if not exists digest text;

comment on column live_pages.digest is
  'Fingerprint of the row as the mirroring browser saw it (cells, title, kind, '
  'description, subpage count). Opaque to the database; compared by the client.';
