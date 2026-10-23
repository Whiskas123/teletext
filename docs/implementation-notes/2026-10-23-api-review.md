# API review and hardening

A review of the site and its API after the three-day outage of 2026-10-20 → 23
(the Node 24 `engines` pin; see `2026-10-20-sub-translation.md`), then the fixes
it recommended.

## 2026-10-23 — what the review found

- **Every function was down for three days and nothing said so.** No uptime
  check, and `/api/health` answered 200 with `ok: false` when the database
  failed, so a check would have read it as up. It also put the driver's error
  message in the public response.
- **Functions in `iad1`, database in `eu-west-2`, visitors in Portugal.** Each
  query crossed the Atlantic; a one-query `/api/health` took ~350 ms.
- **The guestbook's rate limit was keyed on `authorId`, which the browser
  sends.** A script could send a fresh one with every signature, and there was
  no way to remove a signature short of SQL.
- **`/api/auth/login` took unlimited guesses**, for a 30-day session.
- **Only HSTS among security headers**, and `PUT /api/showcase` stored any
  `imageType` it was sent and served it back as `Content-Type`.
- **`api/` at the twelve-function cap**, with three spent on auth and the
  legacy `published_pages` read/resolve still wired into `/manage` though the
  table had nothing left to offer.
- **Main chunk 808 KB / 261 KB gzip**, holding every public screen.
- **Boot pages: 5.7 MB of JSON, ~295 KB gzipped.**
- Couldn't check: `backup_runs`, table sizes, the admin routes. Read-only
  queries against the production database were refused by the session's
  permission rules, and so were later requests to the live site.

## 2026-10-24 — the fixes

- **Region `lhr1`** in `vercel.json`, next to Neon's London.
- **`/api/health`**: answers `HEAD` (what most monitors send), and a 503 with no
  detail when the database fails; the detail goes to the log.
- **Uptime check as a GitHub Actions schedule** rather than an external
  monitor: no account to create, and a failed scheduled run emails whoever last
  changed the workflow. It checks health plus the public reads, because each
  function can fail to load on its own (the outage's errors were per-function
  imports). GitHub pauses schedules after 60 days without a commit — noted in
  the file.
- **Hashed client address** (`clientKey`, HMAC with `SESSION_SECRET`) rather
  than raw IPs in the database. Vercel overwrites `x-forwarded-for`, so it is
  not client-supplied there.
- **Guestbook**: 30 signatures per address per hour on top of the 20 s
  per-author limit — generous because a workshop room shares one address.
  Admin `DELETE ?id=` in the same function, and a red *Apagar* button on each
  entry for moderators, behind a `confirm()`. The hook keeps removed ids out
  of later loads, for the same reason it keeps new ones in: the edge serves the
  book stale for up to a minute.
- **Login**: 20 wrong passwords per address per 15 minutes, then 429 without
  checking. Failures live in `login_failures`, swept on each new failure so
  the table stays one window long without a job.
- Both need **migration 015**, which has to run before the deploy: the
  guestbook insert and the login count query the new column and table.
- **Auth merged** into `api/auth.ts` with a rewrite, so the client's URLs did
  not change. 12 → 10 functions. Translations stay inside `snapshot`: it
  already has the 60 s a Claude call needs.
- **Legacy records removed**: `GET`/`DELETE /api/published`, `LegacyPanel`,
  its actions, fakes and three tests. `PUT` (the render) stays.
- **Showcase pictures** limited to PNG and WebP (415 otherwise); a missing type
  still means PNG, as before.
- **Menus**: a rename onto a taken name is a 409 with a message, not a 500.
- **Headers**: `nosniff`, `frame-ancestors 'self'` + `X-Frame-Options`, and
  `Referrer-Policy` for every path. `'self'` rather than `'none'`, in case the
  exhibit or kiosk ever frames the site; nothing does today.
- **Routes split**: viewer, room, editor and guestbook are lazy. Main chunk
  612 KB / 199 KB gzip. Deliberately **no `<Suspense>`** above them: checked
  with a MutationObserver on a page with a prerender marker — the marker is
  replaced by the viewer in the same mutation, never by an empty root. Client
  navigation runs in React Router's transition, so the old screen stays up.
- **Compact boot cells: measured and dropped.** Leaving default fields out
  (`fg: white`, `bg: black`, `graphics: null`) takes the Oct 19 copy from
  5.73 MB to 4.08 MB raw but only 295 → 283 KB gzipped. Not worth a second
  format, a versioned endpoint for tabs open across a deploy, and a decoder.
- **Guestbook paging: not done.** ~4 KB today; it wants paging somewhere near
  the `MAX_ENTRIES` ceiling, not now.
- **Dead end:** the first version of the "removed signature stays out of a
  stale book" test passed without the fix — the refresh interval was created
  under real timers before `useFakeTimers`. Fake timers now start first, and
  the test asserts a refresh actually happened.
