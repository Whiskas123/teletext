# Playground safeguards: backups, history, reports

The site is permanent and public. The playground (700–999) goes on air the
moment it is drawn, and the question was how to keep that while guarding
against attacks and pages that shouldn't be there.

## 2026-11-04 — what is and isn't protected

- **The archive is safe.** It lives in Postgres behind the admin cookie, and
  archive keys written into playhtml are ignored on read
  (`useContentChannel` → `pickStore(live, false)`).
- **The playground's rules are client-side only.** Every browser writes the
  playhtml room directly, and the room name is in the bundle. Anyone with
  devtools can wipe or draw over every playground page, spam chat, or grow the
  document until playhtml's server can't open it, which happened in October at
  ~8 MB.
- **playhtml has no write rules for us to use.** Its `read-only` is declared by
  the owning page in a client message and enforced in the client. Its server
  (`partykit/party.ts`, a y-partyserver `YServer` on Cloudflare) does limit
  messages per connection and compacts large documents, but doesn't check what
  is written or where. Its own code says document size "is reported, never
  enforced". Its README points at self-hosting for "security guarantees".
- **My mistake:** I first said a playground page only reaches people who dial
  it. Not so: the PLAYGROUND fastext key, page up/down
  (`nextPageWithContent`), search and the Yellow Pages all reach the
  playground. Only the front-page showcase excludes it.

## 2026-11-04 — self-hosting: not now

- Cloudflare Workers Free covers what playhtml's server uses: SQLite-backed
  Durable Objects, hibernation and KV. Limits per day: 100k requests (20
  incoming WebSocket messages count as 1), 13k GB-s, 100k rows written. Traffic
  would fit.
- **Against it:**
  - Past a free limit, operations "fail with an error" until 00:00 UTC, so a
    flood takes live editing down for the day. Paid is $5/month.
  - The server stores documents in Supabase, whose free projects pause after
    7 days of inactivity.
  - It means maintaining a fork of a large server that changes often.
- **Decision:** cheap safeguards now; self-host if vandalism actually happens.
  The incoming-message handler (`onMessage`) is where write rules would go.
- **Hide list dropped:** the delete in /manage already works on playground
  pages and takes effect live, faster than a list read with the boot data.

## 2026-11-05 — what was built

- **Backup every 30 minutes, with a size alarm.** It's a step in
  `uptime.yml` that calls the existing daily read (`GET /api/snapshot` with
  `CRON_SECRET`) and fails above 3 MB. The response already carried `bytes`.
  The Vercel cron at 04:00 stays as a fallback.
- **Version history (migration 017).** This is what makes the frequent backup
  safe. `live_pages` is one row per screen and the backup overwrites it, so
  frequent backups would copy junk over the good version *sooner*.
  - It's a trigger, not code in `writeRows`, so every writer is covered.
  - Playground only, and only when content changed.
  - Kept for 30 days, swept by the trigger itself.
  - `db:restore --at` reads each screen whose
    `[updated_at, replaced_at)` interval contains the time.
- **Report line, not a key on the set** (the user's choice). It's small print
  under the cabinet. On a wide screen it's absolutely positioned under the
  column: the set is sized to the window's height with ~30 px to spare, so a
  line in the flow would resize the set between archive and playground pages.
  It needs a confirm, so a stray click emails nobody. `/api/reports` brings the
  API to 11 functions (the cap is 12).
- **Notification without an email service:** `POST /api/reports?notify`
  returns the reports nobody has been told about and marks them, and the
  workflow step fails when that list isn't empty. A failed run is what
  GitHub emails. It's a stretch of what a check is for, and named as one in
  the workflow.

## Checks

- The trigger and the `--at` query ran against PGlite with every migration
  applied: same-content rewrites keep nothing, overwrites and deletes keep the
  old row, the archive keeps nothing, old versions are swept, and `--at` gives
  the pre-vandalism version.
- The workflow's shell logic was dry-run against sample responses.
- The report line was checked in the preview at 1024×768, at 900×1300, on a
  phone and on an archive page (absent). It wasn't seen in a room on a
  playground page: a room's page changes by a vote in the production room,
  which local dev shares.

## 2026-11-10 — reports dropped

- **The user decided against reports.** Removed before shipping: the report
  line under the set, `/api/reports`, the /manage banner, the `page_reports`
  table and the workflow step that failed on new reports.
- Kept: the half-hourly backup with its size alarm, the version history, and
  `db:restore --at`. The migration is now `017_playground_history.sql`; it had
  not been applied anywhere with the old name, so renaming it is safe.
- Taking a page off air stays what it was: deleting it in /manage.
