# Freezing playground pages

## 2026-11-16 — where the flag lives

- **The ask:** freeze a playground page from /manage once it's good, so other
  visitors can't overwrite it.
- **In playhtml (`frozen-pages`), not Postgres.** The editor has to see a
  freeze the moment it's made. The boot file, which is how visitors read the
  database, is cached at the edge for a day, so a flag in the database would
  leave a page editable for up to a day after it's frozen.
- **Considered and dropped: serving frozen pages from `live_pages`** and
  ignoring playhtml for them, with the mirrors skipping them. That would stop a
  vandal with devtools too. But it needs the frozen list in the boot file (the
  same day of lag), changes to both mirrors' scopes, and a way to write
  playhtml back on unfreeze. That's too much for a threat that hasn't come up.
- **Known ceiling, named in `useFrozenPages.ts`:** like every playground rule
  it's enforced in the browser, so devtools can still write to a frozen page
  or unfreeze it. The version history and `db:restore --at` are the backstop.
  The upgrade path is still write rules in a self-hosted playhtml server (see
  2026-11-05-playground-safeguards.md).

## 2026-11-16 — what was built

- `canEditPage` takes a `frozen` flag. Frozen means read-only for everyone
  except the moderator.
- The editor treats a frozen page like a reserved one. Dialling it is refused
  with "Page N is frozen", and ▲/▼ skip over it. Landing on it, from a link or
  because a freeze arrives while it's open, moves the visitor to the first free
  page and says why.
- /manage has a `❄ Freeze` / `❄ Frozen` button in the inspector header on
  playground pages, and a ❄ in the lineup's status column. The button is
  disabled while the playground isn't connected, because playhtml drops writes
  made before it syncs.

## Checks

- Property test: `canEditPage` with a frozen playground page is false for
  visitors and true for the moderator.
- Clicked through in `manage-preview.html` (in-memory, so no live writes): the
  button toggles and the row gets its ❄.
- Not exercised against the live room: freezing from localhost writes to the
  production document.

## 2026-11-17 — per screen, not per page

- **The user wanted screens frozen, not whole pages.** Visitors should still be
  able to add new screens to a page whose screens are frozen. The whole-page
  version had shipped about an hour earlier (`a48e0ec`).
- **New channel, `frozen-screens`, keyed like `pages` (`"745"`, `"745.2"`).**
  It's a new channel rather than reusing `frozen-pages` so that a page frozen
  under the old meaning doesn't quietly turn into a frozen screen 1. Anything
  frozen in that hour has to be frozen again.
- **Editor:** on a frozen screen, cell writes are dropped in `handleEditCell`
  (every cell write goes through it) and a notice says to press + for a new
  screen. The page itself is no longer refused or skipped. The title belongs to
  the page, so it's read-only while any screen is frozen. − is hidden while the
  last screen is frozen.
- **/manage:** the button moved to the screen actions, next to "Add to front
  page". The screen tiles show ❄, and the lineup row shows ❄ if any screen is
  frozen.
- **Known corner:** reordering or removing screens in /manage doesn't move the
  freeze with the content, because the flag belongs to the screen's number.
- **Found in passing, not fixed:** `/edit/N/2` opens screen 1, because the
  page-change reset in `SoloEditor` also runs when the editor first loads. So
  /manage's "Edit content" link for a later screen lands on screen 1.
- **Checks:** `SoloEditor.frozen.test.tsx` (a frozen screen refuses edits and
  says so; the next screen still takes them), and the button clicked through
  in `manage-preview.html`.
