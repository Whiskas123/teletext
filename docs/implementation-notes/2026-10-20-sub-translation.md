# SUB — English over Portuguese pages

Append-only log. Started 2026-10-20.

## 2026-10-20 — where the translation comes from

- **Browser built-in translation: no.** The moderator works in Safari, which has
  no on-device Translator API, so it can't be the source.
- **Live translation endpoint: no.** `api/` is at the Vercel Hobby cap of twelve
  functions, so a thirteenth fails the deploy. Translations get made ahead of
  time instead.
- **Not in the playhtml document.** The room ran out of memory at about 8 MB on
  2026-10-16 and curated pages moved to `live_pages` (4ee17fa). Translations
  should go to Postgres too, keyed by `(page_number, subpage, digest)` so an
  edited page drops its stale translation. Not built yet.
- **Scope: 100–699 only.** The playground changes too often to translate ahead of
  time.

## 2026-10-20 — spike: does English fit the Portuguese cells?

`scripts/translatePage.ts` reads pages from `live_pages`, cuts each row into runs
(`src/domain/subtitles.ts`), makes one Claude request per page and prints the
Portuguese and English grids side by side. It writes nothing.

- **A run ends at block graphics, a style change, or two blanks.** A single blank
  is a word space. Teletext uses wider gaps to separate columns.
- **Budget = the run's own width.** Widening into blanks to the right would give
  English more room, but it isn't needed yet because Portuguese is usually the
  longer language. The spike's clipped count will show whether this holds.
- **One request per page, not per run.** Sentences wrap across rows, so the model
  needs the whole page to translate one. The structured-output schema has one
  required property per run, so the API rejects a reply that skips a run.
- `claude-opus-5-5` at `medium` effort, with server-side `fallbacks: "default"`.

## 2026-10-20 — first look, five pages translated by hand

No API key yet, so Claude translated 104, 113, 117, 162 and 186 by hand in the
session, following the script's rules, and rendered them side by side in the
teletext palette. All 81 runs fit, with nothing cut off. Two bugs showed up that
the unit check had missed:

- **Invisible letters.** Imported captures often give a blank cell the
  background colour as its foreground. Where English put a letter on a cell that
  was a Portuguese space, the letter disappeared ("O iente S at on"). The fix is
  that `applySubtitles` gives every cell in a run the colours of the run's first
  character.
- **Justified prose broke into pieces.** The recipe page pads word spaces to two
  for justification, so cutting runs at two blanks split sentences in the middle
  and left holes in the English. Runs now end at three blanks. The Euro 2004
  fixture table separates its columns with far more than three, so it still
  splits correctly.
- **Not translatable:** headings drawn in block graphics (EXPO'98, RECEITA DO
  DIA). That's expected — they're pictures, not text.

## 2026-10-20 — the EN key, behind VITE_SUB

- **Called EN, not SUB.** The LED window already labels the subpage `SUB`.
- **Translations are static files** in `public/sub/<page>.json`, which is the
  shape the prerender step would eventually write from Postgres. Each entry
  stores `{row, col, pt, en}`. An entry applies only while the run at that
  position still reads `pt`, so a page edited after translation keeps the
  English that still matches, without needing a digest. The five hand-made
  translations are the test data.
- **No hosting work needed for missing pages.** `vite preview`, and Vercel's SPA
  rewrite, answer `/sub/114.json` with the app's HTML and a 200. The failed JSON
  parse is the "no translation" answer.
- **EN is a mode, and the key follows what's on the glass.** The first version
  toggled the mode. On a page with no translation while the mode was on, the
  lamp was dark, and pressing EN quietly switched the mode off — found in the
  browser. Now: with English showing, EN turns it off; otherwise it asks for
  English, and a page with none lights the lamp red for `SIGNAL_ERROR_MS`, then
  switches it off.
- **Front panel: one function slot.** The gap beside the keypad holds one 26-unit
  key, so EN takes it only when MIX is off. The two keys plus captions and lamps
  don't fit in that column without re-laying it, so with both flags on, EN is on
  the handset only. MIX is off on the published site.
- The `features.ts` mocks in the two MIX tests needed `SUB_ENABLED` added, or
  every test importing the set fails.

## 2026-10-20 — prices lost on 113, a number guard, EN moved

- **Bug: four prices on 113 vanished in English.** I wrote the hand translations
  before the gap rule changed from one blank to two. After the change, rows like
  `1 Dia…  5 000$` became a single run that includes the price, and my English
  still stopped at the dots, so the price got overwritten with blanks. The emit
  check only compared run counts, and price-only runs were never counted
  (they have no letters), so the count stayed the same. Data fixed.
- **Guard: `keepsNumbers`.** Every run of digits in the Portuguese must appear in
  the English, or that run stays Portuguese. `5 mil` → `5,000` passes (the `5`
  is still there). Ordinals (`3ª idade` → `senior`) are left out of the check,
  which the first audit had flagged as false positives. All 81 stored entries
  pass. `translatePage.ts` now lists runs that lost a number.
- **EN moved to the right-hand column.** The user found the gap beside the keypad
  too packed. POWER moves up onto the PAGE row (caption on PAGE's line, lamp to
  its right) and EN takes the SUBPAGE row below it (caption on SUBPAGE's line).
  The gap is MIX's alone again, so a build with both flags now shows both keys
  on the front panel, and the earlier one-slot ceiling is gone.
- **Cost of translating the whole corpus**, measured with `subtitleRuns`: 3,148
  captures, 61,289 runs, 1.11 M characters, 4.07 M characters of request JSON
  (largest page 4.2 K). The token counts below are estimates (≈3 chars/token
  for JSON with Portuguese), not counted:
  ≈ 2.6 M input tokens including the system prompt, and ≈ 0.5 M output tokens
  before thinking. On `claude-opus-5-5` ($4 / $20 per M) that's about $20 before
  thinking, roughly $25–100 in all depending on how much it thinks (≈ $50 at 500
  thinking tokens a page). Batches halves that, but doesn't take `fallbacks`.
  The script's cost line on ~20 real pages will replace this guess.

## 2026-10-20 — /manage shows translations and translates pages

- **Translations moved into Postgres** (`014_page_translations.sql`; the five
  hand-made ones seeded with `model = 'hand'`; `public/sub/` removed). A Translate
  button needs somewhere to write that takes effect without a redeploy, and the
  viewers already read the curated pages from the database.
- **No new function.** `api/` is at the twelve-function cap, so `GET ?sub`
  (public, edge-cached a minute), `GET ?subs` (moderator) and `POST ?translate`
  (moderator) are dispatched from `api/snapshot.ts` into
  `api/_lib/translations.ts`. `snapshot` already has `maxDuration: 60`. The
  Claude call uses a 50 s timeout with no retries, so a slow answer comes back
  as an error the moderator can retry, not a killed function.
- **The Claude call moved to `api/_lib/translate.ts`**, shared with
  `scripts/translatePage.ts`. `@anthropic-ai/sdk` moved from devDependencies to
  dependencies. The prompt now also asks for dotted leaders to be kept.
- **`ANTHROPIC_API_KEY` now belongs on Vercel**, server side only. Earlier notes
  said never to set it there.
- **/manage:** an EN tag on each row (dashed when partial), an English section in
  the inspector (status, Translate / Translate again, English preview), and a
  "Translate all N" button for a selection. Status comes from
  `translationCoverage`, which compares each stored `pt` with what the screen
  says now, so an edited screen shows as partial without anything stored about
  edits. A batch runs one request after another.
- **Testing locally takes two servers.** `vercel dev` runs the API but (a) its
  catch-all rewrite sends Vite's module requests to `index.html`, and (b) it
  unzips `?boot`'s hand-gzipped body but keeps `content-encoding` and the
  compressed `content-length`, which truncates the JSON. So: Vite dev with `/api`
  proxied to `vercel dev`, and `?boot` served from a built `dist/boot/pages.json`.
  Neither problem exists on Vercel itself.
- **Not tested with a real key:** the Translate path was run up to its 503
  ("ANTHROPIC_API_KEY is missing"). Reading, the tags, the preview, the
  selection count and the EN key reading from the API were all checked in the
  browser.

## 2026-10-20 — three quick flashes; EN on for English visitors

- **"No English" lamp:** the steady red for `SIGNAL_ERROR_MS` (4.5 s) is now three
  200 ms red flashes ending dark (`.crt-lamp-flash`, `EN_FAULT_MS = 600`, applied
  to EN's lamp only). MIX's fault lamp is unchanged. With reduced motion it's a
  steady 600 ms red.
- **English visitors start with EN on.** On an `/en` address the mode starts on
  (`SUB_ENABLED` builds only). If the first page (usually 100) has no English, the
  lamp stays dark: no flash, because nobody pressed anything. The mode stays on,
  so the next translated page shows in English. The amber "looking" blink now
  appears only after a press. Before this, an English visitor on 100 saw a brief
  amber blink that looked like "on", then went dark.
- **The 40 "failing on main" tests were the Node version.** Under Node 20.0.0
  (what the shell picked up once an untracked `.nvmrc` went away), jsdom's
  dependencies fail to `require()` an ES module. Under Node 24 — what
  `.claude/launch.json` already pins — all 776 pass. Earlier entries calling
  them pre-existing failures were wrong about the cause.

## 2026-10-23 — the Node 24 pin took every API function down

- **`"engines": { "node": "24.x" }` moved the functions off Bun.** With an
  engines field, Vercel ran every function on `nodejs24.x` instead of the
  `bun1.x` runtime that `"bunVersion": "1.x"` in `vercel.json` had given them
  (`vercel inspect --json` on the deploys before and after shows it). Node's ESM
  loader can't resolve the extensionless relative imports in `api/`
  (`'./_lib/db'`), so every function exited with `ERR_MODULE_NOT_FOUND` at load
  — `FUNCTION_INVOCATION_FAILED`, a 500 with no handler involved. Since the
  deploy of 2026-10-20 16:58 the guestbook said it couldn't reach the book, and
  `/api/health`, snapshot, showcase and the rest were down with it.
- **Removed the engines field; kept `.nvmrc`.** The pin was only ever for local
  tests (jsdom 29), and the tracked `.nvmrc` already covers that. Adding `.js`
  to every relative import would also have worked on Node, but it's a large
  diff to keep a runtime nobody chose.
- **Finding it:** CLI 49's `vercel logs` only streams and showed nothing;
  `bunx vercel@65 logs --since 30m` returned the stack traces at once. Hobby
  keeps runtime logs only briefly, so there was no history for the older
  deploy.

## 2026-10-24 — editing the English by hand

- **Asked for once Translate was live:** a way to fix a translation that is
  close but not right. /manage's English section has an **Edit** button: one
  field per run, under the Portuguese it replaces, `maxLength` = the run's
  cells, with a `n/width` count. The inspector's preview draws the draft as it
  is typed. Empty fields stay Portuguese; a field that drops a number says so
  before saving (`keepsNumbers`), since the EN key would skip it.
- **Stored like any translation**, one entry per run, with `model = 'hand'`, via
  `POST /api/snapshot?sub=<key>` (moderator). POST rather than PUT: `snapshot`
  guards its methods before the translation routes run, and a PUT that missed
  them would fall into the backup's own write path. The server reads the
  Portuguese from `live_pages`, not the request, so an entry always matches the
  screen as saved; a line longer than its run is a 400. All lines empty deletes
  the row, so the screen reads "Not translated" again.
- **Translate again replaces hand edits.** Its tooltip says so, and it is
  disabled while the editor is open. Not guarded further — the moderator who
  edited is the one who would press it.
- **Test note:** the preview can't be asserted in jsdom (`PageThumb` waits for
  an IntersectionObserver that never fires there); checked in
  `manage-preview.html` instead. The first workspace test typed a line longer
  than its run and got it cut — the limit working, so the test now checks it.

## 2026-10-24 — the Portuguese flash on every page change

- **Reported:** with EN on, each page came up in Portuguese for a moment, then
  turned English. Cause: `useSubtitles` fetched `?sub=<page>` as each page came
  up, and drew the Portuguese until the answer landed. Even a page already
  visited flashed for a frame, since its cached answer still arrived through a
  promise.
- **Fix:** one request for every translation (`GET ?sub=all`, public, edge
  cached a minute) the first time a set wants English, kept for the visit;
  each page then looks its English up on the render that shows it. Only
  curated pages are translated, so the list stays small, and a visitor who
  never presses EN never fetches it. The per-page `GET ?sub=<key>` is gone; a
  tab left open across the deploy would get the list, read no `runs`, and
  answer EN with the red lamp until reloaded.
- **Still a wait the first time:** the first press (or the first page for an
  `/en` visitor) waits for the list — the amber lamp's job, as before.
- A failed load is not kept: the next press asks again.
- The regression test re-renders a translated page with the mode on and
  expects English on that same render, no `waitFor`. It failed before the fix.

## 2026-10-24 — English edited in the editor, not in /manage

- **The line-by-line form in /manage was the wrong place.** Rejected after it
  shipped: the editor already edits curated pages for moderators, and the
  English belongs in the grid it is drawn in, not in a list of fields beside
  a thumbnail. The form (`EnglishEditor`, `englishLines`, the hook's
  `lines`/`save`) is gone; /manage's English section now has an **Edit English**
  link to `/edit/<page>/<screen>?lang=en`.
- **The editor's EN key** (`useEnglishDraft`): on a curated screen with a
  translation, it turns the grid to the English. Only letters inside
  translated lines change — the English is the Portuguese page with its words
  swapped, so a brush, a colour or a cell outside a line has nowhere to be
  stored and is refused. Saved as the editor saves, 800 ms after typing stops or
  at once on leaving the screen, through the same `POST ?sub=` route. A line
  still reading its Portuguese is left out unless it already had English, so a
  partly translated screen stays partly translated rather than counting as
  done.
- **The editor remounts per language** (`key="en"|"pt"`) so undo cannot carry
  a Portuguese edit into the English or back.
- **Only on screens that already have a translation**, as asked. Writing
  English from nothing is still Translate, then edit.
- **Not checked in a browser:** the local dev server has no API and no
  sign-in, so the key never appears there. `SoloEditor.test.tsx` covers the
  wiring with the shared-document hooks stubbed; `useEnglishDraft.test.ts`
  covers what is accepted and saved.
