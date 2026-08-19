import { useCallback, useRef } from 'react';

import {
  COLS,
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
 * What a click or a drag does.
 *
 * Two tools, and only two. The page editor also has a *block* brush that stamps
 * a whole 2x3 motif with a colour per part, which is powerful and, on a grid
 * this small, mostly a way to produce a pattern you did not mean. One pixel at
 * a time is the whole of the drawing here.
 */
export type SnippetTool = 'text' | 'pixel';

export interface SnippetGridProps {
  cells: TeletextPage;
  /** Where the caret is, as a cell index, or null when the grid is not focused. */
  cursorIndex: number;
  onCursorChange(index: number): void;
  /** Replace one cell. The caller owns the snippet. */
  onCellChange(index: number, cell: Cell): void;
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

export function SnippetGrid({
  cells,
  cursorIndex,
  onCursorChange,
  onCellChange,
  tool,
  fg,
  bg,
  label,
  hint,
  hintId,
}: SnippetGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Whether a drag is in progress, so moving across the grid with the button
  // up does not paint. A ref rather than state: it changes on every pointer
  // event and nothing renders differently for it.
  const paintingRef = useRef(false);

  /**
   * Which cell, and which sixth of it, the pointer is over.
   *
   * Computed from the grid's own rectangle rather than from per-cell handlers.
   * A touch drag never fires `mouseenter` on the cells it passes over — the
   * browser gives every event to whatever the finger first landed on — so
   * geometry is the only thing that works on a phone, and it costs no handlers.
   */
  const cellAt = useCallback((event: React.PointerEvent) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect == null || rect.width === 0 || rect.height === 0) return null;

    const cellW = rect.width / COLS;
    const cellH = rect.height / SNIPPET_ROWS;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH);
    if (col < 0 || col >= COLS || row < 0 || row >= SNIPPET_ROWS) return null;

    return {
      index: row * COLS + col,
      part: sixelPartAt(x - col * cellW, y - row * cellH, cellW, cellH),
    };
  }, []);

  /**
   * Paint one sixth of a cell, or place the caret, depending on the tool.
   *
   * The cell's own background is carried through untouched. Writing the
   * background picker's colour here was a real bug: an unlit sixth renders in
   * the cell's background, so painting a single pixel repainted the other five
   * as well and one click produced a solid block of colour. The pixel tool
   * changes exactly the sixth under the pointer, which is why the background
   * picker is not offered while it is selected.
   */
  const apply = useCallback(
    (index: number, part: number, erase: boolean) => {
      onCursorChange(index);
      if (tool === 'text') return;

      const cell = cells[index] ?? blankCell();
      const pattern = typeof cell.graphics === 'number' ? cell.graphics : 0;
      const next = setSixelBit(pattern, part, !erase);

      // Six colours, one per sixth, so a cell can hold more than one. Starting
      // from the cell's own colours keeps the five the pointer did not touch.
      const colors: TeletextColor[] = [0, 1, 2, 3, 4, 5].map((i) => {
        const existing = cell.graphicsColors?.[i];
        return (existing ?? fg) as TeletextColor;
      });
      colors[part] = fg;

      // Clearing the last sixth returns the cell to text, rather than leaving
      // an all-off mosaic that looks blank but is not — `isBlankSnippet` counts
      // any graphics cell as ink, so an invisible one would let an empty
      // signature through.
      if (next === 0) {
        onCellChange(index, { char: ' ', fg: cell.fg, bg: cell.bg, graphics: null });
        return;
      }

      onCellChange(index, {
        char: cell.char,
        fg: cell.fg,
        bg: cell.bg,
        graphics: next,
        graphicsColors: colors as unknown as Cell['graphicsColors'],
      });
    },
    [cells, fg, tool, onCellChange, onCursorChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      const hit = cellAt(event);
      if (hit == null) return;
      gridRef.current?.focus();
      paintingRef.current = true;
      // Alt is the eraser, the same chord the page editor's brushes use.
      apply(hit.index, hit.part, event.altKey);
    },
    [apply, cellAt],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!paintingRef.current) return;
      const hit = cellAt(event);
      if (hit == null) return;
      apply(hit.index, hit.part, event.altKey);
    },
    [apply, cellAt],
  );

  const endStroke = useCallback(() => {
    paintingRef.current = false;
  }, []);

  /** Typing, and moving about. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const total = COLS * SNIPPET_ROWS;
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
        case 'Delete': {
          event.preventDefault();
          onCellChange(cursorIndex, blankCell());
          // Backspace steps back and deletes, as it does in a text field;
          // Delete clears in place, as it does in a text field.
          if (event.key === 'Backspace') {
            onCursorChange(Math.max(0, cursorIndex - 1));
          }
          return;
        }
        default:
          break;
      }

      // One printable character. Anything longer is a named key ('Shift',
      // 'F5'), and a modifier chord belongs to the browser.
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      event.preventDefault();
      onCellChange(cursorIndex, { char: event.key, fg, bg, graphics: null });
      onCursorChange(Math.min(total - 1, cursorIndex + 1));
    },
    [cursorIndex, fg, bg, onCellChange, onCursorChange],
  );

  return (
    <>
      <div
        ref={gridRef}
        className="snippet-grid"
        // Focusable so the whole grid takes typing, with the caret as the
        // insertion point. A textbox role would promise a value that can be
        // read and replaced, which a mosaic cannot honour.
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      >
        {cells.map((cell, index) => {
          const isCursor = index === cursorIndex;
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
    </>
  );
}

export default SnippetGrid;
