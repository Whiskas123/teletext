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

**Moderator** is a device-local flag, not a real login — there's no backend, so nothing here is cryptographically enforced (see `src/collab/moderator.ts`). Visit `/moderator` (a small link in the landing page's footer) and enter the passcode set in `VITE_MODERATOR_PASSCODE` (copy `.env.example` to `.env.local` and set your own; on Vercel, set it as a project environment variable — either way it ends up readable in the built JS, so treat it as a courtesy gate against accidental archive edits, not a secret).

## Architecture

There is no backend. State is a single [playhtml](https://playhtml.fun) document (Yjs CRDTs over playhtml's hosted server), mounted once in `GlobalProvider` as the room `teletext-house`. Everything else is a named channel inside it:

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

## Run locally

Uses [Bun](https://bun.sh) for install and scripts.

```bash
bun install
bun run dev      # Vite dev server, e.g. http://localhost:5173
bun run test     # vitest (unit + property + integration)
bun run lint     # eslint
bun run build    # tsc + vite build → dist/
```

Rooms and page content are live against the shared playhtml document, so two browser tabs (or two people) see each other straight away — no local server needed, and no environment variables either unless you want moderator access (see [Archive vs. playground](#archive-vs-playground)).

## Deploy

The app is a static SPA. On [Vercel](https://vercel.com), import the repo and take the detected Vite settings (`vercel.json` pins the framework, `dist` output, and the SPA rewrite so deep links like `/room/kitchen` resolve).

## Tech

- **React 19** + **TypeScript** + **Vite 7**, **React Router 7**
- **playhtml / Yjs** for shared, persisted state
- **vitest** + **@testing-library/react** + **fast-check**
