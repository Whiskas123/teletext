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
