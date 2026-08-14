# Tele-textual

A React app for a workshop on **nostalgia and digital communication before the web**. Watch **teletext** on your own or together with other people in a shared room, and create or edit the pages everyone watches — a 40×24 grid with period-accurate colors, block graphics and aesthetics.

## What is teletext?

Teletext was a text-based information system broadcast in the vertical blanking interval of TV signals (1970s–1990s). Pages were 40 characters wide by 24 rows, with a limited color palette (black, red, green, yellow, blue, magenta, cyan, white) and block graphics — each character cell splittable into a 2×3 grid of six blocks ("sixels").

## The front page

A teletext service opened on a coloured index, and so does this: the wordmark
top left, a `PT/EN` switch top right, and four words down the left in the
palette's colours. Nothing else — a front page with cards and paragraphs on it
is a website *about* teletext, whereas four coloured words on black is the thing
itself. The menu is data ([`src/domain/landing.ts`](src/domain/landing.ts)), so
the colour and the copy for both languages travel with the entry and a fifth way
in is a line rather than a component.

The lettering is `EuropeanTeletext.ttf`, bundled from `src/assets/` — the file
was in the repo, unused, while every screen borrowed "Press Start 2P" from
Google Fonts. That is an arcade face: uniform, square, 8×8. Teletext's is not,
and the difference is the whole look.

Under the wordmark, one line says what this is. Beside it, in the half the
composition leaves empty, **one real page from the archive is on air**, changing
every six seconds; choosing it opens that page. It reads the same live document
the viewer reads, so it shows what is genuinely published rather than
screenshots that go stale, and it cycles a carousel's screens the way a set did.
Two rules decide what is eligible ([`src/domain/showcase.ts`](src/domain/showcase.ts)),
and both matter: never the open playground, which any visitor may write anything
on, and never a page that is claimed by a title or a heading but holds no ink.
With nothing synced yet it renders nothing at all — the space is simply empty,
which is what the front page looks like anyway.

The showcase is taken *out of the flow* on a wide screen. In it, a 24-row page
is a third band competing for the same vertical budget as the wordmark (194px)
and the menu (272px), and on an 832px screen that pushed `sobre` off the bottom.
Out of flow, the left column keeps the geometry of the mockup exactly and the
page still fits on one screen. Narrow, there is no empty right half, so it goes
back into the flow and centres. It also honours `prefers-reduced-motion` by
holding on one page: auto-advancing content is precisely what that setting is
about.

- **ver** — reveals the choice of watching **on your own** (`/watch`) or in one
  of six fixed "house" rooms (`/room/:roomId`), each showing live occupancy.
  Both are watching, so both live under one word instead of competing for the
  front page.
- **criar** — the editor (`/edit`, `/edit/:pageNumber`), opened on the **first
  free playground page**, so two people creating a page at once don't land on
  the same number and overwrite each other.
- **sugerir** / **sobre** — rendered, with nowhere to go yet. They keep their
  colour, because a dimmed word in a four-word index reads as broken rather than
  as forthcoming; what they don't keep is the pretence, so the cursor, a hover
  label and the accessible name all say *em breve*.

The language switch is Portuguese-first — the archive is ~3,150 captures of RTP
and SIC teletext, and the people most likely to want them read Portuguese — and
the choice is remembered in `localStorage`. It currently translates the front
page; the rest of the app is still English.

### Watching, and editing

- **Watch solo** (`/watch`) — the TV on your own. The remote control changes the page immediately, the yellow pages list what's out there, the magnifying glass searches every page by text, and three-digit page numbers in the content are clickable links. No chat, no vote, no name needed.
- **Watch together** (`/room/:roomId`) — everyone in a room sees the same page, chats in the sidebar, and changing the page goes to a **vote**: a request stands for 60 s and needs a majority of the members present when it was raised. You join as `Guest-XXXX` and can rename yourself from the room sidebar.
- **Create / edit pages** (`/edit/:pageNumber`) — edits are per-cell and shared, so a page being edited updates live wherever it's being watched. Pages 100–699 are a curated **archive** (only the moderator can edit them); 700–999 are the open **playground** — see [Archive vs. playground](#archive-vs-playground) below.

## Editing

- **Type** anywhere on the grid; arrow keys, Enter and Tab move the cursor, Backspace/Delete clear. Foreground and background colors come from the "Text style" swatches.
- **Double height** — a Text style toggle. While it's on, typed characters render at twice the row height (a real teletext attribute), covering the cell directly below. Not available on the header row or the last content row. Turning it on for a cell clears the cell beneath it; turning it back off later doesn't bring old content back.
- **Block brush** — paint whole mosaic cells with a *motif*: a 2×3 pattern (solid, checker, split, corners, or six independent parts) with a color per part. Drag to keep painting; **Alt+click** picks up the motif under the pointer.
- **Pixel brush** — paint a **single sixth** of a cell in one color, leaving the other five alone. Drag across sixths to draw fine detail; **Alt+click** erases a sixth, and clearing the last one returns the cell to empty.
- **Blink brush** — set the teletext blink flag on cells; Alt+click removes it.
- **Recent brushes** — the last 8 block/pixel brushes you painted with, with `◀` / `▶` (or `[` / `]`) to step back and forth through them and a strip to jump straight to one.
- **Export PNG** downloads the current page (including double-height cells, rendered the same way); **Clear page** wipes it (with a confirm).
- **Subpages** — the "Subpage" section steps through the page's carousel with `‹ X/Y ›` and adds or removes a screen. Everything else in the editor applies to the screen you are on, so each subpage is a page in its own right. See [Subpages](#subpages).

## Subpages

A teletext page could not be longer than 40×24, so a page with more to say than
fits was broadcast as a **carousel**: page 220 cycling through 220-1, 220-2,
220-3, each a whole page of its own, with the header saying which one you were
looking at. The corpus records this already — `571-0002` is the second screen of
page 571, not a second page — so until now it was information the archive held
and the site threw away.

- **Watching**, the header shows `X/Y` beside the page number, always, including
  `1/1`. A second, smaller pair of knobs under the page knobs steps through the
  carousel, wrapping at both ends. In a room the subpage is synchronized like the
  page number but needs no vote: the room agreed on a page, and turning to the
  next screen of it is reading what was agreed rather than changing it.
- **Editing**, the "Subpage" section steps through the screens and adds or
  removes one. "Remove last" takes the *last* screen rather than the one on show,
  because subpages are numbered by position and removing from the middle would
  renumber everything after it.
- **Searching** covers every screen, since a long story lives on the later ones —
  exactly the content that is hard to find by arrowing through pages. A result
  from screen 2 of page 220 reads `220-2` and lands you there.
- **`/manage`** carries the subpage into the publication: each card has the same
  `‹ X/Y ›` strip with add / remove and a link straight into the editor, and the
  publish panel has a subpage field beside the page number, pre-filled from the
  capture's own `sub`.

### How they are stored

Subpage 1 keeps the plain page-number key it has always had, and subpages 2+ get
a composite `"220.2"` key in the same `pages` channel — see
[`src/domain/subpages.ts`](src/domain/subpages.ts). Nothing needed migrating,
because every page in the document already *is* its own subpage 1, and every
existing reader kept working and kept meaning what it meant: `pages[220]` is
still what page 220 shows when you dial it. A reader with no notion of subpages
*skips* the composite keys rather than misreading them, because `Number("220.2")`
is not an integer and all of them already guard with `Number.isInteger` — which
is asserted as a property test rather than assumed, since a regression there
would corrupt pages silently instead of failing.

How many screens a page has is **stored**, in its own channel, rather than
counted from the keys present. Twice over that is what works: a subpage that has
just been added is empty and would count as absent, and playhtml's draft is a
Proxy with no `deleteProperty` trap — so removing a subpage can only blank its
cells, never take the key away, and a derived count could rise and never fall.

`published_pages` and `live_pages` are keyed by `(page_number, subpage)`
([008](db/migrations/008_subpages.sql)). The backup one is not optional: without
it a snapshot would store screen 1 of every carousel, report success, and drop
the rest — a restore that looks fine and is quietly short.

## Archive vs. playground

Page numbers split into two ranges (`src/domain/access.ts`):

| Range | Who can edit |
|---|---|
| 100–699 (archive) | Moderator only |
| 700–999 (playground) | Everyone |

Everyone can *watch* any page in either range; the split only gates the editor's page-number field, so a non-moderator simply can't select an archive page number there (a link straight to `/edit/:pageNumber` on an archive page falls back to the first playground page instead).

**Moderator** is a real login now. Visit `/moderator` directly — the front page is four words and does not advertise it — and enter the password set in `ADMIN_PASSWORD`; the server checks it and issues an `HttpOnly` session cookie signed with `SESSION_SECRET`. Neither variable is `VITE_`-prefixed, so neither reaches the browser.

This replaced a `VITE_MODERATOR_PASSCODE` compared in the client, which was inlined into the bundle and therefore readable by any visitor, backed by a `localStorage` flag anyone could set from the console. See `api/_lib/auth.ts`.

## Architecture

Two stores, with different jobs.

**[playhtml](https://playhtml.fun) is the live layer.** A single document (Yjs CRDTs over playhtml's hosted server), mounted once in `GlobalProvider` as the room `teletext-house`. Everything a visitor reads or edits lives here, and every concurrent edit is merged per-cell by the CRDT. Nothing about live editing goes through a server round trip — that is the whole reason this project moved off Redis, where two simultaneous edits meant one whole-page write landing on top of the other.

**Neon Postgres is the system of record.** Everything the CRDT is the wrong tool for: ~3,150 archive captures nobody is currently editing, which capture is published to which page number, admin authentication, and a durable backup of the live document. See [`.kiro/specs/archive-database/design.md`](.kiro/specs/archive-database/design.md).

Publishing crosses between them: `/manage` records the decision in the database, gets the cells back, and writes them into playhtml. Backups cross the other way. Reading never touches the database.

The playhtml channels:

| Channel | Scope | Contents |
|---|---|---|
| `pages` | global | `{ [pageNumber]: { [cellIndex]: Cell } }` — one Yjs key per cell, so concurrent edits to different cells merge and edits to the same cell converge last-writer-wins. Subpages 2+ live under a composite `"220.2"` key in the same map (see [Subpages](#subpages)) |
| `titles` | global | page titles for the yellow pages directory |
| `page-kinds` | global | whether each page is a category, subcategory, subsubcategory or ordinary page — the directory's shape |
| `subpage-counts` | global | how many screens each page's carousel holds; absent means one |
| `descriptions` | global | page descriptions, so pages made by hand can have one too |
| `room-sync:<roomId>` | per room | the page the room is watching |
| `chat:<roomId>` | per room | the room's messages |
| `vote:<roomId>` | per room | the active change request and its votes |
| `presence:<roomId>` | per room | member heartbeats (3 s), stale after 8 s |

Decision logic lives in `src/domain/` — framework-free and covered by ~20 [fast-check](https://fast-check.dev) property tests (page normalization and navigation, vote tallying/eligibility/resolution, chat append ordering, CRDT convergence). The `src/collab/` hooks only bind that logic to playhtml; `src/components/` renders it.

### Routes

| Route | Screen |
|---|---|
| `/` | The front page — the coloured index |
| `/watch`, `/watch/:pageNumber`, `/watch/:pageNumber/:subpage` | Solo viewer |
| `/room/:roomId` | Room viewer (chat, presence, voting) |
| `/edit`, `/edit/:pageNumber`, `/edit/:pageNumber/:subpage` | Editor |
| `/moderator` | Moderator sign-in |
| `/import` | Decode archive renders into pages (admin) |
| `/manage` | Choose which captures are published where (admin) |

## Run locally

Uses [Bun](https://bun.sh) for install and scripts.

```bash
bun install
bun run dev      # Vite dev server, e.g. http://localhost:5173
bun run test     # vitest (unit + property + integration)
bun run lint     # eslint
bun run build    # tsc + vite build → dist/
```

Rooms and page content are live against the shared playhtml document, so two browser tabs (or two people) see each other straight away — no local server needed, and no environment variables either unless you want moderator access or the archive management screens.

## The archive database

The corpus (`archive-corpus-rtp/`, `archive-corpus-sic/`) is ~3,150 captures across ~830 original page numbers. Page numbers were reused for unrelated content over the years, so several captures sharing a number are usually *different pages*, not versions of one — which is why the archive is browsed by **topic** (the on-disk folder division) rather than by number alone.

Set up, in order:

```bash
bun run db:verify-decoder      # libvips must agree with the browser before importing
bun run db:migrate             # create the schema
bun run db:import-corpus       # decode and catalogue both corpora (~10 min)
bun run db:import-seed         # preserve the hand-authored seed pages
```

If you imported before capture images were stored, backfill them without
re-decoding the corpus:

```bash
bun run db:migrate           # applies 002-004
bun run db:backfill-images
```

`db:import-corpus` accepts `--dry-run` (decode and report, write nothing), `--source rtp|sic`, and `--limit N`.

Then sign in at `/moderator` and use `/manage` to assign captures to page numbers.

### The management screen

Results are paginated — without that the browser only ever showed the first 60 captures by page number, which are all `indice`, so "all topics" looked broken when it was really the first page of an ordered list.

Captures are browsed by **topic** and era, as a grid of their actual renders — choosing between four captures of page 220 means reading what's on them. Each is the original GIF or PNG re-encoded as lossless WebP: ~2.2 KB, *smaller* than the source file, and they load lazily as you scroll and cache for a year.

(An earlier version sent one palette colour per cell — 960 bytes drawn to a 40×24 canvas — on the theory that a page is recognisable by layout and colour before it's readable. That's true of a graphics-heavy page and false of almost every page here, because teletext is mostly text: reducing a cell to one colour throws the glyph away, and the result was a smear of dots. Lossy WebP was measured too and is *three times larger* than lossless at this content — photographic compression has nothing to work with on flat colour and hard edges.)

Selecting one shows two previews side by side, both scaled to fit rather than cropped: what will be published, and what is on the target page **right now**. That second preview reads the live playhtml document, not the database, so it includes any collaborative edits since publication — publishing overwrites it, so it's worth seeing what goes.

Two adjustments can be applied on the way out:

- **Shift down one row** — moves every row down and drops the last. Removes a duplicate four-colour menu strip, and re-aligns captures sitting a row higher than the rest. **On by default**, since most captures need it; untick it per page when they don't.
- **A custom menu** — replaces the bottom four-colour fastext strip. Menus are named, saved and reused, since the same strip goes on dozens of pages; the editor previews through the same function that publishes, so what you see is what lands.

Both are recorded on the publication rather than baked only into the cells, so a menu can be edited and re-applied, and any page can be explained later.

### Searching

The magnifying glass beside the Yellow Pages searches every page's **title and text**, case- and accent-insensitively — the archive is Portuguese, and nobody looking for `eleicoes` should have to type `eleições`. Results show the page number (and the subpage, when the hit is on a later screen of a carousel) and the line the match is on, with the hit highlighted; choosing one requests that page the same way a directory listing does (straight away when watching solo, through the room vote when watching together).

Reading text back out of a 40×24 grid has a few catches that decide whether the search is any use, so it lives in [`src/domain/pageSearch.ts`](src/domain/pageSearch.ts) with its own tests: a block-graphics cell keeps whatever character was last typed there and must read as a gap rather than splicing noise into a word, and teletext lays pages out with padding, so runs of blanks collapse to a single space or a row reads as one long line.

### Categories in the Yellow Pages

The directory is a tree: sections, sub-sections, sub-sub-sections, and the pages beneath them. Each page is marked **category**, **subcategory**, **subsubcategory** or **page** — from the picker on its card in `/manage`, or at the moment it is published from the archive — and the nesting is read off page-number order: a heading owns everything that follows it until the next heading at the same level or above. The heading levels live in one list, `HEADING_KINDS` in `src/domain/directory.ts`, and position in that list *is* depth, so another level is a one-line change rather than a new branch in the nesting, the occupancy check and the directory renderer.

The tree is derived, never stored, which is the point: nothing can be orphaned or point at a missing parent, and **moving a block moves a whole section intact**, because the tree is only ever a reading of the order. A subcategory with no category above it is promoted rather than hidden, and so is a page before the first heading — a page missing from the index would be invisible with nothing to show it had happened.

Kinds live in playhtml alongside titles, not in Postgres. The directory is a public read path shown to every visitor, and nothing else about ordinary browsing touches the database; kinds also apply to hand-made pages, which exist only in the live document. They move with a page when it is renumbered, and they are carried by the snapshot and restore.

### Moving pages around

Page numbers are positions, not names — 200 is where the news starts because that is where it was put — so slotting something in *before* an existing run, or relocating a whole section, is ordinary editing. Doing it by hand means republishing every page above, each one overwriting a live page on the way past.

- **Make room at N for k pages** pushes N and everything above it up by k (or pulls it back down).
- **Move pages a–b so they start at c** relocates a whole run, sliding whatever it passes over to close the gap behind it. The destination does not need to be free: the block's span of numbers travels, and the pages it crosses move the other way by exactly that span — the same set of numbers, reordered.
- **← →** on a card nudge one page along. A block of one.

All of them renumber the records *and* carry the content.

Each card also has **Edit** (title and description, for any page — not only archive ones) and **Delete**, which takes the content, title, heading role, description and publication record with it and asks first.

**Occupancy is every page, not every published page.** The plan is made against the union of the archive publications in Postgres and everything in the live playhtml document — seeded pages, pages people made by hand, the playground. Planning from the publication records alone was a real bug: a hand-made page at 201 is invisible there, so shifting 200 up silently overwrote it. Only a connected browser can see the live document, so the client sends those page numbers with the request. Archive pages are still refused entry to the playground (700+), where anyone could edit them.

Ordering is the whole difficulty: moving 200→201 while 201 exists destroys 201. [`src/domain/reorder.ts`](src/domain/reorder.ts) emits an ordered plan in which every destination is free when written, and where that is impossible — a rotation, where every destination is occupied and nothing can go first — it lifts content out, slides the rest, and puts it back. The identical plan is replayed against both stores, which is why it is a pure, property-tested module rather than a query. Its tests simulate a store and fail the moment a step would clobber a page.

### Backups

`live_pages` holds a copy of the playhtml document, which otherwise exists only on playhtml's hosted server with no export. Press **Back up live pages now** on `/manage`, or let the daily Vercel cron hit `/api/snapshot`.

Only a connected browser can read the Yjs document, so the cron alone cannot refresh the backup — it reports freshness; the button does the work. Restore with `bun run db:restore --out restore.json`, then load that file from `/import`. Rehearse it once: an untested backup is not a backup.

### Five render sizes

RTP published at three sizes (520x400, 400x300, 320x250), SIC at two (320x240, 480x336). They differ in more than cell size: RTP renders 40x25 and one row is dropped on import, SIC renders 40x24 and nothing is dropped. And a shared cell size does not mean a shared font — SIC's 320x240 uses the same 8x10 cells as RTP's 320x250 without sharing a single stencil, because SIC draws two-pixel stems where RTP draws one.

All 3,148 captures decode. 223 cells out of 3.04 million (0.007%) still hold an unrecognised stencil, across 44 rare glyphs; they show up on `/import`, and teaching one now saves it to the shared atlas for every machine.

One caveat worth knowing: SIC's fonts draw capital `O` and digit `0` with identical pixels, so no single cell can distinguish them. The decoder resolves it from the surrounding word — `220` on its leading `2`, `MUNDO` on its `M`. It is the only heuristic in an otherwise exact decoder, and the rendered page is the same either way.

## Deploy

On [Vercel](https://vercel.com), import the repo and take the detected Vite settings. `vercel.json` pins the framework, `dist` output, the daily backup cron, and the SPA rewrite.

That rewrite is `/((?!api/).*)` rather than `/(.*)` for a reason: the catch-all form swallows every serverless function and returns `index.html` with a 200, so a broken API looks exactly like a working one. `GET /api/health` returns JSON if routing is correct.

Set `DATABASE_URL` (via the Neon integration), `ADMIN_PASSWORD`, `SESSION_SECRET`, and optionally `CRON_SECRET` — see `.env.example`.

## Tech

- **React 19** + **TypeScript** + **Vite 7**, **React Router 7**
- **playhtml / Yjs** for shared, live state
- **Neon Postgres** + Vercel serverless functions for the archive, publication map and auth
- **sharp** (dev only) to decode corpus images outside a browser
- **vitest** + **@testing-library/react** + **fast-check**
