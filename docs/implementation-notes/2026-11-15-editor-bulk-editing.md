# Editor: bulk editing, shapes, zoom, presence

The edit page was good at one cell at a time and had nothing for more than
that. Asked for ideas, then asked to build all of them.

## 2026-11-15 — what was built and what was decided

- **All the "which cells become what" logic is pure**, in
  `src/domain/editOps.ts`, and the editor only writes the result through its
  one cell writer. That is what makes every new thing one undo step for free,
  and what let the freehand painters and the shapes share one definition of
  what the brush does to a cell (`blockCell`, `withSixelPart`, `erasedCell`,
  lifted out of `Editor.tsx`).
- **Shapes preview by writing.** A line or box being dragged is written to the
  page on every pointer sample: cells the previous sample covered are put back
  from the page as it was at pointer-down, then the new shape is painted, all
  inside one open history step. The put-backs net out (`recordWrite` keeps the
  first `before`), so undo removes the finished shape whole. Considered an
  overlay-only preview and dropped it: it would need a second renderer for
  mosaics. Cost: anyone watching the page sees the shape rubber-band.
- **Selection is a fourth tool, not a mode of Write.** Shift+arrows in Write
  would have needed a second cursor model. Entering Select starts on the
  cursor's cell and leaving it puts the cursor at the selection's corner, so
  the two still point at one place.
- **Clipboard: cells travel as a custom MIME type beside plain text**
  (`application/x-teletext-cells`), so a copied block pastes into another tab
  or page. What comes back is anybody's JSON, so it goes through
  `normalizeCell` and a size check. If a browser drops the custom type, the
  editor falls back to its own last copy when the plain text matches.
- **Phone zoom is a 2× key and a minimap**, not pinch. A finger on the page is
  a brush, so there is no gesture left for panning; two-finger pan would have
  meant cancelling a stroke already begun, and could not be tried without a
  touch device. The key floats over the page's top-right corner, which covers
  the end of the clock: there is no free pixel on a phone-width stage.
- **Presence is its own channel (`presence:edit`)**, not `usePresence`, which
  is tied to a room id. Cursor publishes are throttled to 4 a second. Incoming
  presence is checked (cursor in range, name valid) and the colour is derived
  locally from the member id rather than trusted.
- **Undo history is kept per screen** (20 screens) instead of cleared on
  leaving. It is only ever applied to the screen it belongs to.
- **Remote cursors were positioned with a hard-coded 14px font** and had been
  wrong since the grid became responsive. They now sit in an overlay inside
  the grid's own box, in percentages, with the selection and the cell lines.

## Not done, on purpose

- Alt+letter was already swallowed by the grid's key handler before this, so
  Alt-composed characters on a Mac (`@` on a Portuguese layout) still cannot be
  typed into the grid. Alt+T/D/B/S/G now do something; the rest is as it was.
- Shapes do not apply to the Blink tool.
- Local dev talks to the production room, so the write paths were verified in
  the jsdom tests (`Editor.test.tsx`, `editOps.test.ts`) and only the
  non-writing parts (panels, selection outline, grid lines, zoom, copy-from
  drawer) were looked at in the browser.

## 2026-11-15 — after the first look: a toolbox, and less in Select

Feedback from João on the first build: the recolour palettes and the row keys
in the Select panel were not understandable ("if it's too complex just
remove"), the shape choice needed icons, and the panel as a whole was hard to
read — make it closer to Paint.

- **Recolour and row insert/delete are removed**, with `recolour` and
  `shiftRows` in `editOps.ts`. Two unlabelled palettes that act on a selection
  looked like the Write tool's colour pickers and did something else.
- **The four tool keys with switches inside them became nine tool keys**:
  Select, Text, Eyedropper, Brush, Eraser, Fill, Line, Rectangle, Blink. The
  editor's state underneath is unchanged (`tool`, `drawShape`, `eraseOn`,
  `picking`); a toolbox key just sets a combination of them, and which key is
  lit is read back off that state. This reverses the earlier decision recorded
  in `Editor.tsx` to fold eraser, size and eyedropper *into* Draw — that made
  the row tidy and the eraser hard to find.
- **The eraser no longer combines with Line, Rectangle or Fill** from the
  panel; holding Alt still erases with any of them.
- **On a phone the nine keys are one row without captions.** Nine captions at
  375px are unreadable, and two rows would take the height the keyboard needs.
- Shortcut letters changed to match: S T I B E F L R, and P for Blink (piscar).
