# Implementation Plan: Archive Database & Publication Management

## Status

Implemented, including the SIC render support in task 10 that this work
uncovered. The whole corpus decodes: 3,148 of 3,148 captures. The one open item
is 3.5, rehearsing the restore, which needs a live database first.

Nothing runs until Neon is provisioned: `DATABASE_URL`, `ADMIN_PASSWORD` and
`SESSION_SECRET` have to be set before the schema or the corpus can be loaded.

## Tasks

- [x] 1. Database provisioning and connection
  - [x] 1.1 Connection helpers — `api/_lib/db.ts` (HTTP driver for routes,
        lazily read `DATABASE_URL` with a message naming the fix) and
        `scripts/lib/pool.ts` (pooled WebSocket connection for the scripts,
        which run thousands of statements and need multi-statement SQL)
  - [x] 1.2 Unblocked the API routes — `vercel.json` rewrite changed from
        `/(.*)` to `/((?!api/).*)`; added `api/health.ts`, which reports
        unconfigured/connected/error rather than 500ing on an unmigrated database
  - [x] 1.3 Schema — `db/migrations/001_initial.sql` plus `scripts/migrate.ts`
        (transactional, recorded in `schema_migrations`, re-runnable)

- [x] 2. Batch import of the corpus
  - [x] 2.1 `src/domain/archiveManifest.ts` normalises the two manifests;
        33 tests. Resolved three real discrepancies:
    - `tier` (RTP resolution) and `bucket` (SIC page band) sit in the same slot
      and mean unrelated things — kept as separate columns
    - `timestamps` is an array whose entries RTP repeats once per resolution
      tier, so it is de-duplicated before counting capture days
    - the manifest `topic` is stale; the on-disk folder wins (see 2.4)
  - [x] 2.2 `scripts/lib/loadImageNode.ts` (sharp, no resize / no ICC / no
        premultiply) and `scripts/verifyDecoder.ts`. Both fixture GIFs decode
        **208,000 pixels identical** to the browser-derived ground truth
  - [x] 2.3 `scripts/importCorpus.ts` — upserts on `(source, digest)`, records
        suspect decodes rather than dropping them, supports `--dry-run`,
        `--source` and `--limit`
  - [x] 2.4 Locate images by filename, take the topic from the folder found.
        Recovered 235 RTP captures that appeared missing and corrected 236
        classifications, 70 of them into a `horoscopo` folder the manifest has
        no concept of
  - [x] 2.5 `scripts/importSeedPages.ts` preserves the hand-authored seed pages
        into `live_pages` before task 8 deletes the seeding code

- [x] 3. Snapshot: make live edits recoverable
  - [x] 3.1 `src/domain/pageEncoding.ts` converts between playhtml's index map
        and the stored array; 6 property tests covering the round trip
  - [x] 3.2 `api/snapshot.ts` — upserts, never deletes, so a partly-synced
        client cannot erase the backup; refuses pages it would have had to
        repair rather than storing a blank over a good one
  - [x] 3.3 `src/collab/useSnapshot.ts` and a "Back up live pages now" button on
        `/manage`; daily Vercel cron in `vercel.json`
  - [x] 3.4 `scripts/restoreFromSnapshot.ts` writes a loadable file
  - [ ] 3.5 **Rehearse the restore once.** Not something that can be done before
        the database exists, and an untested backup is not a backup

- [x] 4. Server-side authentication
  - [x] 4.1 `api/_lib/auth.ts` — HMAC-signed expiring tokens, timing-safe
        comparison via fixed-width digests, fails closed on every missing
        variable; 18 tests including tampered, extended, expired and
        foreign-secret tokens
  - [x] 4.2 `api/auth/login.ts`, `logout.ts`, `me.ts`; `HttpOnly`, `Secure`,
        `SameSite=Strict`
  - [x] 4.3 `src/collab/adminSession.ts` replaces `moderator.ts` (deleted);
        `useIsModerator` keeps its boolean shape so its call sites are untouched

- [x] 5. Publication API and rules
  - [x] 5.1 `src/domain/publication.ts`; 11 property tests, including that no
        valid publication ever targets the playground range
  - [x] 5.2 `api/captures/index.ts` (filter by topic, group, era, source, page;
        never returns cells) and `api/captures/[id].ts`
  - [x] 5.3 `api/published.ts` and `api/published/[page].ts`

- [x] 6. Management UI — `/manage`, lazy-loaded, with `useArchiveAdmin`
      sequencing the two-store publish

- [x] 7. Shared glyph atlas — `api/glyphs.ts` and
      `src/collab/useLearnedGlyphs.ts`, with `localStorage` demoted to a cache

- [x] 8. Removed the seed-overwrite path — `seedPages.ts` deleted,
      `GlobalProvider` no longer seeds. Rewrote `migration.smoke.test.ts`, which
      asserted "no `api/` directory" and would otherwise have to be deleted; it
      now tests the invariant that was actually meant — live page modules make
      no server round trips — plus two new guards against client-side secrets

- [x] 9. Documentation — `README.md`, `.env.example`, this spec

- [x] 10. **SIC render support** — done

  All 1,235 SIC captures now decode; the corpus is complete at 3,148 of 3,148.

  - [x] 10.1 `RenderProfile.sourceRows` replaces the global `SOURCE_ROWS`
        assumption; `droppedRow` is `null` when nothing is dropped
  - [x] 10.2 `glyphAtlasSic8x10.ts` — 114 glyphs for the 320x240 font
        (1,170 captures), built by pooling unplaced stencils across the corpus
        and reading them off as ASCII
  - [x] 10.3 `glyphAtlasSic12x14.ts` — 103 glyphs for 480x336 (85 captures),
        plus its sixel band geometry measured (4/6/4 rows, not an even split)
  - [x] 10.4 `resolveHomoglyphs` for `O`/`0`, which SIC's fonts draw identically
  - [x] 10.5 Tooling kept for the remaining long tail: `sicContactSheet.ts`,
        `sicDoubleHeight.ts`, `applySicAtlas.ts`, `dumpPageText.ts`

  Residual: 223 cells of 3.04 million (0.007%) across 44 rare stencils remain
  unrecognised. They surface on the import screen and now persist to the shared
  atlas when taught, rather than being guessed at here.
