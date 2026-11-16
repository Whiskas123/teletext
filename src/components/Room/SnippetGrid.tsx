import { useCallback, useEffect, useRef } from 'react';

import {
  COLS,
  SIXEL_COLS,
  SIXEL_ROWS,
  setSixelBit,
  sixelBit,
  sixelPartAt,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../../types/teletext';
import { SNIPPET_ROWS } from '../../domain/guestbook';

/**
 * SnippetGrid — the 40x8 grid a guestbook signature is drawn on.
 *
 * ## Why this is not {@link TeletextGrid}
 *
 * The page grid is 40x24 in a dozen places that matter: a memo boundary per
 * row, pointer arithmetic against a fixed row count, a header overlay on row 0,
 * a fastext strip on row 23, and a cursor that has to step around double-height
 * cells. All of that is tuned for the 960 cells a page has and is used by both
 * the viewer and the editor, and parameterising it by row count to serve a
 * guestbook would put the site's two most-used screens at risk for the benefit
 * of its smallest one.
 *
 * A snippet is 320 cells with no header, no strip and no double height, which
 * is small enough to render plainly — no per-row memoisation, no per-cell
 * handlers. What it *does* share is everything that defines how a teletext cell
 * looks and behaves: the `.teletext-*` classes, the sixel sub-grid, and the bit
 * arithmetic in `types/teletext.ts`. Nothing about the palette or the mosaic is
 * written twice.
 *
 * The read-only rendering of a *saved* signature is not this component at all —
 * that is a canvas (`TeletextThumbnail`), because a list of them would be
 * thousands of nodes of something nobody clicks.
 */

/**
 * What a click or a drag does: type, paint a sixth of a cell, or rub out.
 *
 * The page editor also has a *block* brush that stamps a whole 2x3 motif with
 * a colour per part, which is powerful and, on a grid this small, mostly a way
 * to produce a pattern you did not mean. One pixel at a time is the whole of
 * the drawing here. The eraser is a tool of its own because a phone has no Alt
 * key to hold, which was the only way to erase before.
 */
export type SnippetTool = 'text' | 'pixel' | 'eraser';

export interface SnippetGridProps {
  cells: TeletextPage;
  /** Where the caret is, as a cell index, or null when the grid is not focused. */
  cursorIndex: number;
  onCursorChange(index: number): void;
  /** Replace one cell. The caller owns the snippet. */
  onCellChange(index: number, cell: Cell): void;
  /** A stroke or a keystroke is about to change the snippet: the moment to keep for undo. */
  onEditStart?(): void;
  tool: SnippetTool;
  fg: TeletextColor;
  bg: TeletextColor;
  /** Names the grid for anyone who cannot see it. */
  label: string;
  /** Said under the grid, and tied to it as its description. */
  hint: string;
  hintId: string;
}

/** The empty cell, in the one shape the rest of the app agrees on. */
function blankCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

/**
 * What the hidden input holds between keystrokes: one space.
 *
 * A phone's keyboard does not send a usable `keydown` for Backspace on an empty
 * field, so the field is never empty: a keystroke that leaves it empty was a
 * Backspace, and anything longer than the sentinel is what was typed.
 */
const SENTINEL = ' ';

/**
 * A cell with one sixth painted or rubbed out.
 *
 * The cell's own background is carried through untouched. Writing the
 * background picker's colour here was a real bug: an unlit sixth renders in
 * the cell's background, so painting a single pixel repainted the other five
 * as well and one click produced a solid block of colour.
 */
function paintPart(cell: Cell, part: number, fg: TeletextColor, erase: boolean): Cell {
  // The eraser over a letter, or a coloured space, takes the whole cell: there
  // is no sixth of a character to remove.
  if (erase && typeof cell.graphics !== 'number') return blankCell();

  const pattern = typeof cell.graphics === 'number' ? cell.graphics : 0;
  const next = setSixelBit(pattern, part, !erase);

  // Six colours, one per sixth, so a cell can hold more than one. Starting
  // from the cell's own colours keeps the five the pointer did not touch.
  const colors: TeletextColor[] = [0, 1, 2, 3, 4, 5].map(
    (i) => (cell.graphicsColors?.[i] ?? fg) as TeletextColor,
  );
  if (!erase) colors[part] = fg;

  // Clearing the last sixth returns the cell to text, rather than leaving an
  // all-off mosaic that looks blank but is not — `isBlankSnippet` counts any
  // graphics cell as ink, so an invisible one would let an empty signature
  // through.
  if (next === 0) return { char: ' ', fg: cell.fg, bg: cell.bg, graphics: null };

  return {
    char: cell.char,
    fg: cell.fg,
    bg: cell.bg,
    graphics: next,
    graphicsColors: colors as unknown as Cell['graphicsColors'],
  };
}

/** A place on the grid in sixths: 80 across, 24 down. */
type Pixel = [x: number, y: number];

/**
 * Every pixel from `from` to `to`, leaving out `from` (Bresenham).
 *
 * A drag is sampled: a quick hand crosses several pixels between two pointer
 * reports, and painting only the reported ones drew a dotted line.
 */
function pixelsBetween([x, y]: Pixel, [x1, y1]: Pixel): Pixel[] {
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let error = dx - dy;
  const pixels: Pixel[] = [];
  for (let guard = 0; guard < dx + dy && (x !== x1 || y !== y1); guard += 1) {
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }
    pixels.push([x, y]);
  }
  return pixels;
}

export function SnippetGrid({
  cells,
  cursorIndex,
  onCursorChange,
  onCellChange,
  onEditStart,
  tool,
  fg,
  bg,
  label,
  hint,
  hintId,
}: SnippetGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  /**
   * What typing goes through.
   *
   * The grid used to take `keydown` itself, as a focusable `div`. A phone only
   * raises its keyboard for a real text field, so on a phone the grid could
   * not be typed on at all — and on a desk a dead key (`´` then `e`) arrives
   * as a composition, not a `keydown`, so accents could not be typed either.
   * A real input, out of sight, has both.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  // The last pixel a stroke painted, or null when no stroke is in progress. A
  // ref rather than state: it changes on every pointer event and nothing
  // renders differently for it.
  const strokeRef = useRef<Pixel | null>(null);
  /** Cells written since the last render, which `cells` does not show yet. */
  const pendingRef = useRef(new Map<number, Cell>());
  useEffect(() => {
    pendingRef.current.clear();
  }, [cells]);

  const total = COLS * SNIPPET_ROWS;

  /**
   * Which pixel the pointer is over.
   *
   * Computed from the grid's own rectangle rather than from per-cell handlers.
   * A touch drag never fires `mouseenter` on the cells it passes over — the
   * browser gives every event to whatever the finger first landed on — so
   * geometry is the only thing that works on a phone, and it costs no handlers.
   */
  const pixelAt = useCallback((event: React.PointerEvent): Pixel | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect == null || rect.width === 0 || rect.height === 0) return null;

    const cellW = rect.width / COLS;
    const cellH = rect.height / SNIPPET_ROWS;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH);
    if (col < 0 || col >= COLS || row < 0 || row >= SNIPPET_ROWS) return null;

    const part = sixelPartAt(x - col * cellW, y - row * cellH, cellW, cellH);
    return [col * SIXEL_COLS + (part % SIXEL_COLS), row * SIXEL_ROWS + Math.floor(part / SIXEL_COLS)];
  }, []);

  /** Paint, or rub out, a run of pixels. Several may be sixths of one cell. */
  const paint = useCallback(
    (pixels: Pixel[], erase: boolean) => {
      const pending = pendingRef.current;
      for (const [x, y] of pixels) {
        const index = Math.floor(y / SIXEL_ROWS) * COLS + Math.floor(x / SIXEL_COLS);
        const part = (y % SIXEL_ROWS) * SIXEL_COLS + (x % SIXEL_COLS);
        const cell = pending.get(index) ?? cells[index] ?? blankCell();
        const next = paintPart(cell, part, fg, erase);
        pending.set(index, next);
        onCellChange(index, next);
      }
    },
    [cells, fg, onCellChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      const pixel = pixelAt(event);
      if (pixel == null) return;
      onCursorChange(Math.floor(pixel[1] / SIXEL_ROWS) * COLS + Math.floor(pixel[0] / SIXEL_COLS));
      if (tool === 'text') {
        // Raises the keyboard on a phone; only for typing, so that drawing
        // does not have one sliding up over it.
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      onEditStart?.();
      strokeRef.current = pixel;
      // Alt is the eraser, the same chord the page editor's brushes use.
      paint([pixel], tool === 'eraser' || event.altKey);
    },
    [pixelAt, onCursorChange, tool, onEditStart, paint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const from = strokeRef.current;
      if (from == null) return;
      const pixel = pixelAt(event);
      if (pixel == null) return;
      paint(pixelsBetween(from, pixel), tool === 'eraser' || event.altKey);
      strokeRef.current = pixel;
    },
    [pixelAt, paint, tool],
  );

  const endStroke = useCallback(() => {
    strokeRef.current = null;
  }, []);

  /** Backspace: step back and clear, as in a text field. */
  const backspace = useCallback(() => {
    onEditStart?.();
    onCellChange(cursorIndex, blankCell());
    onCursorChange(Math.max(0, cursorIndex - 1));
  }, [cursorIndex, onCellChange, onCursorChange, onEditStart]);

  /**
   * Whatever the input has been given since it was last emptied.
   *
   * Called for every `input` event outside a composition, and when a
   * composition ends — browsers disagree about which of those comes last, and
   * whichever does finds the text; the other finds only the sentinel.
   */
  const commitInput = useCallback(() => {
    const input = inputRef.current;
    if (input == null || input.value === SENTINEL) return;
    const value = input.value;
    input.value = SENTINEL;
    if (value === '') return backspace();

    const typed = value.replace(SENTINEL, '').normalize('NFC');
    let at = cursorIndex;
    let started = false;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(typed)) {
      if (segment < ' ') continue;
      if (!started) onEditStart?.();
      started = true;
      onCellChange(at, { char: segment, fg, bg, graphics: null });
      at = Math.min(total - 1, at + 1);
    }
    onCursorChange(at);
  }, [backspace, cursorIndex, fg, bg, total, onCellChange, onCursorChange, onEditStart]);

  /** Moving about, and the keys that are not characters. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const move = (to: number) => {
        event.preventDefault();
        onCursorChange(Math.max(0, Math.min(total - 1, to)));
      };

      switch (event.key) {
        case 'ArrowLeft':
          return move(cursorIndex - 1);
        case 'ArrowRight':
          return move(cursorIndex + 1);
        case 'ArrowUp':
          return move(cursorIndex - COLS);
        case 'ArrowDown':
          return move(cursorIndex + COLS);
        case 'Home':
          return move(Math.floor(cursorIndex / COLS) * COLS);
        case 'End':
          return move(Math.floor(cursorIndex / COLS) * COLS + COLS - 1);
        case 'Enter':
          return move((Math.floor(cursorIndex / COLS) + 1) * COLS);
        case 'Backspace':
          event.preventDefault();
          return backspace();
        case 'Delete':
          // Clears in place, as it does in a text field.
          event.preventDefault();
          onEditStart?.();
          return onCellChange(cursorIndex, blankCell());
        default:
          // A character: it arrives through the input, composed.
          break;
      }
    },
    [cursorIndex, total, backspace, onCellChange, onCursorChange, onEditStart],
  );

  return (
    <div className="snippet-wrap">
      <input
        ref={inputRef}
        type="text"
        className="snippet-input"
        defaultValue={SENTINEL}
        aria-hidden="true"
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onInput={(event) => {
          if (!(event.nativeEvent as InputEvent).isComposing) commitInput();
        }}
        onCompositionEnd={commitInput}
      />
      <div
        ref={gridRef}
        className="snippet-grid"
        // Focusable, so Tab reaches it; focus is passed straight to the input,
        // which is what the keys go to. A textbox role would promise a value
        // that can be read and replaced, which a mosaic cannot honour.
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        onFocus={() => {
          if (tool === 'text') inputRef.current?.focus({ preventScroll: true });
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      >
        {cells.map((cell, index) => {
          // The caret is where typing lands; a brush has no use for one.
          const isCursor = tool === 'text' && index === cursorIndex;
          const graphics =
            typeof cell.graphics === 'number' && cell.graphics >= 0 ? cell.graphics : null;
          return (
            <div
              key={index}
              className={`teletext-cell snippet-cell teletext-fg-${cell.fg} teletext-bg-${cell.bg}${
                isCursor ? ' cursor' : ''
              }`}
              aria-hidden="true"
            >
              {graphics == null ? (
                cell.char === ' ' ? (
                  ' '
                ) : (
                  cell.char
                )
              ) : (
                <div className="teletext-sixel">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`teletext-sixel-dot teletext-bg-${
                        sixelBit(graphics, i) ? (cell.graphicsColors?.[i] ?? cell.fg) : cell.bg
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="snippet-hint" id={hintId}>
        {hint}
      </p>
    </div>
  );
}

export default SnippetGrid;
