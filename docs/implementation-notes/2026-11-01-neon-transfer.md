# Neon network transfer

Neon warned on 2026-10-31 that the project (`neon-citron-mountain`) had used
80% (4 GB) of the free plan's 5 GB monthly public network transfer. At the limit
the compute is suspended until the next billing period.

## 2026-10-31 — what was using it

- **`GET /api/snapshot?boot` pulled 8.36 MB per uncached request**, measured on
  the wire against Neon's `/sql` endpoint: no `content-encoding`, even when
  asked for gzip. The function then compressed it to 333 KB for the visitor, so
  nothing at the edge showed the cost.
- **The edge cache does not protect a quiet site.** `s-maxage=60`,
  `stale-while-revalidate=600`: a visit more than ten minutes after the last one
  is a full read. 4 GB is about 480 reads.
- **A 304 is not a saving.** The logs show the function answering 304; Vercel
  derives the ETag from the body, so the read has already happened.
- Smaller: builds read `live_pages` too (22 in October, ~185 MB). The cron reads
  digests only. Capture images are admin-only and cached for a year.
- Couldn't check: Neon's own per-day usage (no API key here), and which of the
  sampled `/api/snapshot` calls were `boot` — Vercel's logs omit the query
  string and only go back about an hour on this plan.

## 2026-11-01 — the fix

- **Store the gzip body in Postgres (`boot_cache`), read that.** Chosen over a
  longer edge cache, the one-line option: at the 60 s the site has, edits reach
  visitors in a minute, and an hourly refresh on a steadily visited site would
  still be ~6 GB a month. Six hours fits the allowance and makes edits lag by
  hours.
- **The version is computed on each read, not maintained by writers.** Writers
  are `writeRows`, the cron and scripts, and none can forget to invalidate. It
  also means `fresh` reads from `/manage` can use the copy.
- **Hash of every row's `updated_at`, not `max(updated_at)` plus a count.** With
  overlapping transactions the later commit can hold the earlier `now()`, which
  moves neither the max nor the count, and that page would stay stale until the
  next write.
- **Base64 in `text`, not `bytea`.** The HTTP driver returns `bytea` as hex:
  about 666 KB against 444 KB, on the bytes this exists to save.
- Left alone: the 8.36 MB read in `scripts/prerender.ts`, about 5% of the total.
- **Deploy order matters:** the read query names `boot_cache`, so
  `bun run db:migrate` must land before the code, or `?boot` answers 500 and
  viewers fall back to the build's `/boot/pages.json`.
