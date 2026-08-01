# Teletext Rooms

A React app for a workshop on **nostalgia and digital communication before the web**. Watch **teletext** on your own or together with other people in a shared room, and create or edit the pages everyone watches — a 40×24 grid with period-accurate colors, block graphics and aesthetics.

## What is teletext?

Teletext was a text-based information system broadcast in the vertical blanking interval of TV signals (1970s–1990s). Pages were 40 characters wide by 24 rows, with a limited color palette (black, red, green, yellow, blue, magenta, cyan, white) and block graphics — each character cell splittable into a 2×3 grid of six blocks ("sixels").

## The three ways in

From the landing page:

- **Watch solo** (`/watch`) — the TV on your own. The remote control changes the page immediately, the yellow pages list what's out there, and three-digit page numbers in the content are clickable links. No chat, no vote, no name needed.
- **Watch together** (`/room/:roomId`) — join one of six fixed "house" rooms (living room, bedrooms, kitchen, garage, dining room). Everyone in a room sees the same page, chats in the sidebar, and changing the page goes to a **vote**: a request stands for 60 s and needs a majority of the members present when it was raised. You join as `Guest-XXXX` and can rename yourself from the room sidebar.
- **Create / edit pages** (`/edit`, `/edit/:pageNumber`) — the editor. Edits are per-cell and shared, so a page being edited updates live wherever it's being watched. Pages 100–699 are a curated **archive** (only the moderator can edit them); 700–999 are the open **playground** — see [Archive vs. playground](#archive-vs-playground) below.

## Editing

- **Type** anywhere on the grid; arrow keys, Enter and Tab move the cursor, Backspace/Delete clear. Foreground and background colors come from the "Text style" swatches.
- **Double height** — a Text style toggle. While it's on, typed characters render at twice the row height (a real teletext attribute), covering the cell directly below. Not available on the header row or the last content row. Turning it on for a cell clears the cell beneath it; turning it back off later doesn't bring old content back.
- **Block brush** — paint whole mosaic cells with a *motif*: a 2×3 pattern (solid, checker, split, corners, or six independent parts) with a color per part. Drag to keep painting; **Alt+click** picks up the motif under the pointer.
- **Pixel brush** — paint a **single sixth** of a cell in one color, leaving the other five alone. Drag across sixths to draw fine detail; **Alt+click** erases a sixth, and clearing the last one returns the cell to empty.
- **Blink brush** — set the teletext blink flag on cells; Alt+click removes it.
- **Recent brushes** — the last 8 block/pixel brushes you painted with, with `◀` / `▶` (or `[` / `]`) to step back and forth through them and a strip to jump straight to one.
- **Export PNG** downloads the current page (including double-height cells, rendered the same way); **Clear page** wipes it (with a confirm).

## Archive vs. playground

Page numbers split into two ranges (`src/domain/access.ts`):

| Range | Who can edit |
|---|---|
| 100–699 (archive) | Moderator only |
| 700–999 (playground) | Everyone |

Everyone can *watch* any page in either range; the split only gates the editor's page-number field, so a non-moderator simply can't select an archive page number there (a link straight to `/edit/:pageNumber` on an archive page falls back to the first playground page instead).

**Moderator** is a real login now. Visit `/moderator` (a small link in the landing page's footer) and enter the password set in `ADMIN_PASSWORD`; the server checks it and issues an `HttpOnly` session cookie signed with `SESSION_SECRET`. Neither variable is `VITE_`-prefixed, so neither reaches the browser.

This replaced a `VITE_MODERATOR_PASSCODE` compared in the client, which was inlined into the bundle and therefore readable by any visitor, backed by a `localStorage` flag anyone could set from the console. See `api/_lib/auth.ts`.

## Architecture

Two stores, with different jobs.

**[playhtml](https://playhtml.fun) is the live layer.** A single document (Yjs CRDTs over playhtml's hosted server), mounted once in `GlobalProvider` as the room `teletext-house`. Everything a visitor reads or edits lives here, and every concurrent edit is merged per-cell by the CRDT. Nothing about live editing goes through a server round trip — that is the whole reason this project moved off Redis, where two simultaneous edits meant one whole-page write landing on top of the other.

**Neon Postgres is the system of record.** Everything the CRDT is the wrong tool for: ~3,150 archive captures nobody is currently editing, which capture is published to which page number, admin authentication, and a durable backup of the live document. See [`.kiro/specs/archive-database/design.md`](.kiro/specs/archive-database/design.md).

Publishing crosses between them: `/manage` records the decision in the database, gets the cells back, and writes them into playhtml. Backups cross the other way. Reading never touches the database.

The playhtml channels:

| Channel | Scope | Contents |
|---|---|---|
| `pages` | global | `{ [pageNumber]: { [cellIndex]: Cell } }` — one Yjs key per cell, so concurrent edits to different cells merge and edits to the same cell converge last-writer-wins |
| `titles` | global | page titles for the yellow pages directory |
| `room-sync:<roomId>` | per room | the page the room is watching |
| `chat:<roomId>` | per room | the room's messages |
| `vote:<roomId>` | per room | the active change request and its votes |
| `presence:<roomId>` | per room | member heartbeats (3 s), stale after 8 s |

Decision logic lives in `src/domain/` — framework-free and covered by ~20 [fast-check](https://fast-check.dev) property tests (page normalization and navigation, vote tallying/eligibility/resolution, chat append ordering, CRDT convergence). The `src/collab/` hooks only bind that logic to playhtml; `src/components/` renders it.

### Routes

| Route | Screen |
|---|---|
| `/` | Landing — the three entry points |
| `/watch`, `/watch/:pageNumber` | Solo viewer |
| `/room/:roomId` | Room viewer (chat, presence, voting) |
| `/edit`, `/edit/:pageNumber` | Editor |
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

`db:import-corpus` accepts `--dry-run` (decode and report, write nothing), `--source rtp|sic`, and `--limit N`.

Then sign in at `/moderator` and use `/manage` to assign captures to page numbers.

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
