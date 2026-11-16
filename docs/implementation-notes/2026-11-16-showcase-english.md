# Front-page strip in English — 2026-11-16

`/en` showed the strip's Portuguese pictures under English copy. The pictures
are PNGs drawn once on /manage, so there was nothing English to show.

## Decisions

- **Store a second picture, don't draw on the front page.** Applying the
  translation in the visitor's browser would bring back the per-visit canvas
  work the stored pictures exist to avoid. `showcase_pages` gets `image_en` and
  `title_en` (migration 020), drawn in the same `useShowcase.add` call from the
  translation stored at that moment (`translatePage`, what the EN key shows).
- **Fallback is the Portuguese**, per page, the same rule as the EN key: no
  translation → `image_en` null → the strip shows the Portuguese picture.
- **Translations are read fresh (`?subs`) in `add`**, not from the visitor
  cache in `useSubtitles`, so Redraw right after Translate draws the new English.
- `?subs-move` copies the new columns too, or renumbering a page would have
  quietly dropped its English picture.

## Known gap

An English picture is a snapshot like the Portuguese one: translating a page
that is already on the strip does not change it until it is redrawn. Existing
entries have no English picture until each is redrawn once.
