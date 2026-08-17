import { useCallback, useEffect, useRef, useState } from "react";
import {
  brushKey,
  recordBrush,
  stepBrush,
  type Brush,
  type BrushHistoryState,
} from "../../domain/brush";
import {
  describeTextStyle,
  isRecordableTextStyle,
  recordTextStyle,
  stepTextStyle,
  textStyleKey,
  type TextStyle,
  type TextStyleHistoryState,
} from "../../domain/textStyle";
import {
  IconBack,
  IconBlink,
  IconBlock,
  IconDoubleHeight,
  IconExport,
  IconPipette,
  IconPixel,
  IconTextCursor,
  IconTrash,
} from "./icons";
import {
  brushColorsFromSlots,
  COLS,
  DEFAULT_SIXEL_COLORS,
  indexAt,
  MAX_DOUBLE_HEIGHT_ROW,
  MIN_DOUBLE_HEIGHT_ROW,
  motifSlotCount,
  MOTIF_PATTERNS,
  ROWS,
  rowColFromIndex,
  setSixelBit,
  sixelBit,
  SIXEL_BITS,
  SIXEL_MAX,
  resolveDoubleHeightCursor,
  slotColorsFromBrush,
  TELETEXT_COLOR_HEX,
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type SixelColors,
  type TeletextColor,
  type TeletextPage,
} from "../../types/teletext";
import { cellsBetween } from "../../domain/strokeLine";
import { exportPageAsPng } from "../../utils/exportPng";
import { useMediaQuery } from "../../utils/useMediaQuery";
import { TeletextGrid } from "../TeletextGrid/TeletextGrid";

const SIXEL_TOOLTIP_MARGIN = 8;
const SIXEL_TOOLTIP_WIDTH = 200;
const SIXEL_TOOLTIP_HEIGHT = 90;

const SIXEL_TOOLTIP_GAP = 8;

const SIXEL_PART_NAMES: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  "Top-left",
  "Top-right",
  "Mid-left",
  "Mid-right",
  "Bottom-left",
  "Bottom-right",
];

function clampTooltipToViewport(anchor: {
  part: { top: number; height: number };
  preview: { left: number; width: number };
}): { left: number; top: number } {
  const m = SIXEL_TOOLTIP_MARGIN;
  const w = SIXEL_TOOLTIP_WIDTH;
  const h = SIXEL_TOOLTIP_HEIGHT;
  const left = Math.min(
    anchor.preview.left + anchor.preview.width + SIXEL_TOOLTIP_GAP,
    window.innerWidth - m - w,
  );
  const top = Math.max(
    m,
    Math.min(anchor.part.top, window.innerHeight - m - h),
  );
  return { left, top };
}

/** Get the first grapheme cluster (one user-perceived character, e.g. é or a). */
function getFirstGrapheme(str: string): string {
  if (!str) return "";
  const normalized = str.normalize("NFC");
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = [...segmenter.segment(normalized)];
  return segments[0]?.segment ?? "";
}

/** True if the string is only a dead key or combining character – wait for the letter to compose (e.g. ´ + e → é). */
function isDeadKeyOrCombiningOnly(str: string): boolean {
  if (!str) return false;
  const first = getFirstGrapheme(str);
  if (!first || first.length !== str.length) return false;
  if (first.length > 1) return false;
  const cp = first.codePointAt(0);
  if (cp === undefined) return false;
  if (/\p{M}/u.test(first)) return true;
  const deadKeyCodePoints = new Set([
    0x00b4, 0x0060, 0x005e, 0x007e, 0x00a8, 0x00af, 0x02da, 0x02c7, 0x02cb,
    0x2018, 0x2019, 0x2032, 0x2033,
  ]);
  return deadKeyCodePoints.has(cp);
}

/** Default sixel colors for a motif pattern (used when that motif has no saved colors yet). */
function defaultColorsForMotif(
  slots: (typeof MOTIF_PATTERNS)[number]["slots"],
): SixelColors {
  return brushColorsFromSlots(
    slots,
    slotColorsFromBrush(slots, DEFAULT_SIXEL_COLORS),
  );
}

/** Resolve a remote-cursor color (a teletext color name or a raw CSS color) to a CSS color value. */
function resolveCursorColor(color: string): string {
  return (TELETEXT_COLOR_HEX as Record<string, string | undefined>)[color] ?? color;
}

/** A default empty cell value, matching createEmptyPage()'s cell shape. */
function emptyCellValue(): Cell {
  return { char: " ", fg: "white", bg: "black", graphics: null };
}

/**
 * Preview of a remembered brush: the 2×3 motif for a block brush, a single
 * filled square for a pixel brush.
 */
function BrushSwatch({ brush }: { brush: Brush | undefined }) {
  if (!brush) return null;
  if (brush.kind === "pixel") {
    return (
      <span
        className={`brush-pixel-swatch teletext-bg-${brush.color}`}
        aria-hidden
      />
    );
  }
  return (
    <span className="preset-motif-preview" aria-hidden>
      {([0, 1, 2, 3, 4, 5] as const).map((i) => (
        <span
          key={i}
          // Unlit sixths are drawn black, or a brush picked off a half-filled cell
          // would be indistinguishable in the strip from a solid one.
          className={`preset-motif-dot teletext-bg-${
            sixelBit(brush.pattern, i) ? brush.colors[i] : "black"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Preview of a remembered text style: a letter in the pair, so the swatch shows
 * what it would look like to type rather than two abstract squares.
 */
function TextStyleSwatch({ style }: { style: TextStyle | undefined }) {
  if (!style) return null;
  return (
    <span
      className={`text-style-swatch teletext-fg-${style.fg} teletext-bg-${style.bg}${
        style.doubleHeight ? " text-style-swatch-double-height" : ""
      }`}
      aria-hidden
    >
      A
    </span>
  );
}

/** Another Member's editing cursor rendered on the shared grid, attributed by Identity color. */
export interface EditorRemoteCursor {
  /** Cell index (0..959) the remote member's cursor is on. */
  index: number;
  /** The remote member's Identity color (teletext color name or CSS color). */
  color: string;
  /** The remote member's display name, shown as a small label. */
  name: string;
}

interface EditorProps {
  /** Page number used for header/export (does not by itself render a back button). */
  pageNumber?: number;
  /**
   * Which screen of the page's carousel is being edited, and how many there
   * are — shown in the grid's header as `X/Y`, exactly as a viewer sees it, so
   * the editor is never ambiguous about which subpage the keystrokes land on.
   */
  subpage?: number;
  subpageCount?: number;
  /** When set, renders a "Back to grid" button in the sidebar actions that calls this. */
  onBackToGrid?: () => void | Promise<void>;
  /**
   * Optional content rendered at the top of the sidebar (under the title), used
   * by hosts (e.g. the solo editor) to add a cohesive "Page" section — a back
   * link, page-number chooser, and title field — instead of a separate bar.
   */
  sidebarHeader?: import('react').ReactNode;
  /** The page to edit, supplied by the host (e.g. `useEditPage`'s normalized page). */
  page: TeletextPage;
  /**
   * Single-cell edit callback. Every edit (typing, painting, blink, backspace,
   * clear) is applied through this callback as an absolute cell value at
   * `index`, so a collaborative store can persist and merge edits at cell
   * granularity (Req 6.1, 6.5).
   */
  onEditCell: (index: number, cell: Cell) => void;
  /**
   * Controlled cursor index. When provided, the Editor uses it as the local
   * cursor position instead of its own internal state.
   */
  cursorIndex?: number;
  /** Notified whenever the local cursor position changes (e.g. to publish presence). */
  onCursorChange?: (index: number | null) => void;
  /** Other members' editing cursors to render on the grid, attributed by color (Req 6.6). */
  remoteCursors?: EditorRemoteCursor[];
}

export function Editor({
  pageNumber,
  subpage = 1,
  subpageCount = 1,
  onBackToGrid,
  sidebarHeader,
  page,
  onEditCell,
  cursorIndex: controlledCursorIndex,
  onCursorChange,
  remoteCursors,
}: EditorProps) {
  // Cursor is controlled when a cursorIndex prop is supplied; otherwise local.
  const cursorControlled = controlledCursorIndex !== undefined;
  const [localCursorIndex, setLocalCursorIndex] = useState(COLS);
  const cursorIndex = cursorControlled ? controlledCursorIndex : localCursorIndex;
  const setCursorIndex = useCallback(
    (next: number) => {
      if (!cursorControlled) setLocalCursorIndex(next);
      onCursorChange?.(next);
    },
    [cursorControlled, onCursorChange],
  );

  // Single-cell writer: every edit funnels through the host's cell-level
  // callback so a collaborative store can merge edits per cell.
  const writeCell = useCallback(
    (index: number, cell: Cell) => {
      onEditCell(index, cell);
    },
    [onEditCell],
  );

  // Whole-page clear: apply an empty cell to every position.
  const clearPage = useCallback(() => {
    for (let i = 0; i < TOTAL_CELLS; i++) onEditCell(i, emptyCellValue());
  }, [onEditCell]);

  const [fg, setFg] = useState<TeletextColor>("white");
  const [bg, setBg] = useState<TeletextColor>("black");
  /** When on, typed characters render at double the row height (text only — not the block/pixel brushes). */
  const [doubleHeightOn, setDoubleHeightOn] = useState(false);
  const [clearConfirmShown, setClearConfirmShown] = useState(false);
  type BrushMode = "off" | "block" | "pixel" | "blink" | "picker";
  const [brushMode, setBrushMode] = useState<BrushMode>("off");
  /**
   * Which sub-cells the block brush lights, 0-63.
   *
   * `SIXEL_MAX` — the whole cell — until the eyedropper lifts a shape off the
   * page. Picking a motif puts it back, because a motif is a colour arrangement
   * for a full cell and painting it as somebody else's half-filled shape would be
   * two decisions in one control.
   */
  const [blockPattern, setBlockPattern] = useState<number>(SIXEL_MAX);
  const [motifColors, setMotifColors] = useState<(SixelColors | undefined)[]>(
    () => MOTIF_PATTERNS.map(() => undefined),
  );
  const [selectedMotifIndex, setSelectedMotifIndex] = useState(0);
  /** Color the pixel brush paints a single sixth with. */
  const [pixelColor, setPixelColor] = useState<TeletextColor>("white");
  /** Recently used brushes (index 0 = most recent) and the ◀ ▶ stepper cursor. */
  const [brushes, setBrushes] = useState<BrushHistoryState>(() => ({
    history: [],
    index: 0,
  }));
  /** Recently used text styles, the typing counterpart of the brush strip. */
  const [textStyles, setTextStyles] = useState<TextStyleHistoryState>(() => ({
    history: [],
    index: 0,
  }));
  /** Sixel sub-cell (0-5) the pixel brush is currently aimed at. */
  const [hoveredPartIndex, setHoveredPartIndex] = useState<number | null>(null);
  const [selectedSixelIndex, setSelectedSixelIndex] = useState(0);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [colorTooltipOpen, setColorTooltipOpen] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    part: { left: number; top: number; width: number; height: number };
    preview: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);
  const isDrawingRef = useRef(false);
  /**
   * The last cell this stroke painted, so the gap to the next one can be filled.
   *
   * A drag is sampled, not continuous: the browser reports the pointer perhaps
   * sixty times a second, and a hand moving quickly crosses several cells
   * between two reports. Painting only the reported cells drew a dashed line —
   * solid where the hand was slow, gapped where it was fast. See
   * `domain/strokeLine.ts`.
   */
  const lastPaintedRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const sixelColorTooltipRef = useRef<HTMLDivElement>(null);
  const brushSixelPreviewRef = useRef<HTMLDivElement>(null);

  /** Remember a brush that was just painted with (see `domain/brush.ts`). */
  const rememberBrush = useCallback((brush: Brush) => {
    setBrushes((prev) => recordBrush(prev, brush));
  }, []);

  /** Remember a text style that was just typed with (see `domain/textStyle.ts`). */
  const rememberTextStyle = useCallback((style: TextStyle) => {
    if (!isRecordableTextStyle(style)) return;
    setTextStyles((prev) => recordTextStyle(prev, style));
  }, []);

  /** Make a remembered style the active one, and go back to typing. */
  const applyTextStyle = useCallback((style: TextStyle) => {
    setFg(style.fg);
    setBg(style.bg);
    setDoubleHeightOn(style.doubleHeight);
    setBrushMode("off");
  }, []);

  /** Step the style cursor and switch to whatever it lands on. */
  const stepTextStyleHistory = useCallback(
    (delta: number) => {
      const index = stepTextStyle(textStyles.history, textStyles.index, delta);
      const style = textStyles.history[index];
      if (!style) return;
      applyTextStyle(style);
      setTextStyles((prev) => ({ ...prev, index }));
    },
    [textStyles, applyTextStyle],
  );

  /** Jump straight to a style in the strip. */
  const selectTextStyleFromHistory = useCallback(
    (index: number) => {
      const style = textStyles.history[index];
      if (!style) return;
      applyTextStyle(style);
      setTextStyles((prev) => ({ ...prev, index }));
    },
    [textStyles, applyTextStyle],
  );

  const selectedMotif = MOTIF_PATTERNS[selectedMotifIndex];
  const brushColors: SixelColors =
    motifColors[selectedMotifIndex] ??
    defaultColorsForMotif(selectedMotif.slots);
  const motifSlotColors = slotColorsFromBrush(selectedMotif.slots, brushColors);

  const paintCell = useCallback(
    (index: number) => {
      writeCell(index, {
        ...page[index],
        char: " ",
        fg: "white",
        bg: "black",
        graphics: blockPattern,
        graphicsColors: [...brushColors],
      });
      setCursorIndex(index);
      rememberBrush({
        kind: "block",
        motifIndex: selectedMotifIndex,
        colors: [...brushColors] as SixelColors,
        pattern: blockPattern,
      });
    },
    [
      brushColors,
      blockPattern,
      writeCell,
      page,
      setCursorIndex,
      rememberBrush,
      selectedMotifIndex,
    ],
  );

  /**
   * Paint (or erase) a single sixth of a cell, leaving the other five alone.
   *
   * A cell that was showing text becomes a graphics cell with just this one
   * sub-block lit; clearing the last lit sub-block returns the cell to a plain
   * empty cell (`graphics: null`) so it doesn't count as page content.
   */
  const paintSixelPart = useCallback(
    (index: number, part: number, erase: boolean) => {
      const cell = page[index];
      const base = typeof cell.graphics === "number" ? cell.graphics & 0x3f : 0;
      const next = setSixelBit(base, part, !erase);
      // Dragging fires many events over the same sixth; skip writes that would
      // not change the cell so the collaborative store isn't spammed.
      const unchanged =
        next === base &&
        cell.char === " " &&
        (erase || cell.graphicsColors?.[part] === pixelColor) &&
        (next !== 0 || cell.graphics == null);
      if (unchanged) {
        setCursorIndex(index);
        return;
      }
      if (next === 0) {
        writeCell(index, {
          ...cell,
          char: " ",
          fg: "white",
          bg: "black",
          graphics: null,
          graphicsColors: undefined,
        });
      } else {
        const colors = [
          ...(cell.graphicsColors ?? (["black", "black", "black", "black", "black", "black"] as const)),
        ] as TeletextColor[];
        if (!erase) colors[part] = pixelColor;
        writeCell(index, {
          ...cell,
          char: " ",
          fg: "white",
          bg: "black",
          graphics: next,
          graphicsColors: colors as unknown as SixelColors,
        });
      }
      setCursorIndex(index);
      if (!erase) rememberBrush({ kind: "pixel", color: pixelColor });
    },
    [page, writeCell, pixelColor, setCursorIndex, rememberBrush],
  );

  const paintBlinkCell = useCallback(
    (index: number, value: boolean) => {
      writeCell(index, { ...page[index], blink: value });
      setCursorIndex(index);
    },
    [writeCell, page, setCursorIndex],
  );

  const setMotifSlotColor = useCallback(
    (slotIndex: number, color: TeletextColor) => {
      const slots = selectedMotif.slots;
      const next = [...motifSlotColors];
      next[slotIndex] = color;
      const newColors = brushColorsFromSlots(slots, next);
      setMotifColors((prev) => {
        const n = [...prev];
        n[selectedMotifIndex] = newColors;
        return n;
      });
    },
    [selectedMotif, selectedMotifIndex, motifSlotColors],
  );

  const selectMotif = useCallback((index: number) => {
    setSelectedMotifIndex(index);
    // A motif is a colour arrangement for a whole cell, so choosing one clears
    // any shape the eyedropper had lifted.
    setBlockPattern(SIXEL_MAX);
  }, []);

  /**
   * Make a remembered brush the active one: select its mode and restore the
   * motif + colors (block) or the color (pixel) it was used with.
   */
  const applyBrush = useCallback((brush: Brush) => {
    if (brush.kind === "pixel") {
      setPixelColor(brush.color);
      setBrushMode("pixel");
      return;
    }
    setSelectedMotifIndex(brush.motifIndex);
    setMotifColors((prev) => {
      const n = [...prev];
      n[brush.motifIndex] = [...brush.colors] as SixelColors;
      return n;
    });
    setBlockPattern(brush.pattern);
    setBrushMode("block");
  }, []);

  /** Step the history cursor and switch to whatever brush it lands on. */
  const stepBrushHistory = useCallback(
    (delta: number) => {
      const index = stepBrush(brushes.history, brushes.index, delta);
      const brush = brushes.history[index];
      if (!brush) return;
      applyBrush(brush);
      setBrushes((prev) => ({ ...prev, index }));
    },
    [brushes, applyBrush],
  );

  /** Jump straight to a brush in the strip. */
  const selectBrushFromHistory = useCallback(
    (index: number) => {
      const brush = brushes.history[index];
      if (!brush) return;
      applyBrush(brush);
      setBrushes((prev) => ({ ...prev, index }));
    },
    [brushes, applyBrush],
  );

  const pickMotifFromCell = useCallback(
    (index: number) => {
      const cell = page[index];
      if (cell && typeof cell.graphics === "number" && cell.graphicsColors) {
        const picked = [...cell.graphicsColors] as SixelColors;
        setMotifColors((prev) => {
          const n = [...prev];
          n[selectedMotifIndex] = picked;
          return n;
        });
      }
    },
    [page, selectedMotifIndex],
  );

  const focusHiddenInput = useCallback(() => {
    hiddenInputRef.current?.focus();
  }, []);

  /**
   * The eyedropper: take a cell's appearance and become the tool that made it.
   *
   * Which tool that is follows from the cell, because a teletext cell is either a
   * character or a mosaic and never both — `graphics` being a number is exactly
   * that distinction (see `Cell` in `types/teletext.ts`). So the mode the picker
   * lands in is read off the page rather than chosen separately:
   *
   * - **A character cell** hands its colours to the text tool and puts the cursor
   *   where it was picked, ready to type in the style just lifted. A blank cell
   *   counts: its background is a real choice worth copying.
   * - **A graphics cell** hands its six colours *and* its shape to the block
   *   brush, so the next click stamps what was picked rather than a solid block.
   *
   * Either way the brush is remembered, so it lands in the recent-brushes strip
   * alongside the ones chosen by hand.
   */
  const pickFromCell = useCallback(
    (index: number) => {
      const cell = page[index];
      if (cell == null) return;

      if (typeof cell.graphics === "number") {
        const pattern = cell.graphics & 0x3f;
        // Falls back to the cell's own foreground, which is what `SixelBlock`
        // renders a lit part with when no per-part colour was stored.
        const colors = [
          ...(cell.graphicsColors ??
            (Array(SIXEL_BITS).fill(cell.fg) as TeletextColor[])),
        ] as unknown as SixelColors;

        setMotifColors((prev) => {
          const next = [...prev];
          next[selectedMotifIndex] = colors;
          return next;
        });
        setBlockPattern(pattern);
        setBrushMode("block");
        rememberBrush({
          kind: "block",
          motifIndex: selectedMotifIndex,
          colors,
          pattern,
        });
        return;
      }

      const style: TextStyle = {
        fg: cell.fg,
        bg: cell.bg,
        doubleHeight: cell.doubleHeight === true,
      };
      applyTextStyle(style);
      // Lifted styles join the strip like typed ones, so picking a heading off the
      // page is enough to have it to hand for the rest of the session.
      rememberTextStyle(style);
      setCursorIndex(index);
      focusHiddenInput();
    },
    [
      page,
      selectedMotifIndex,
      rememberBrush,
      applyTextStyle,
      rememberTextStyle,
      setCursorIndex,
      focusHiddenInput,
    ],
  );

  /**
   * Which sixth of a cell the pointer is over, from the event's position within
   * the cell element. Returns null when the position can't be determined.
   */
  /**
   * Paint every cell from where the stroke was to where it now is.
   *
   * `cellsBetween` excludes the cell the stroke came from — it was painted by
   * the sample before — and includes the one it arrived at, so a brush that
   * toggles is never applied twice to the same cell in one stroke.
   */
  const paintAlong = useCallback(
    (index: number, paint: (cellIndex: number) => void) => {
      for (const cellIndex of cellsBetween(lastPaintedRef.current ?? index, index)) {
        // The header row is not drawable, and a stroke that crosses it should
        // step over rather than stop.
        if (cellIndex >= COLS) paint(cellIndex);
      }
      lastPaintedRef.current = index;
    },
    [],
  );

  /** Begin a stroke at `index`: nothing to interpolate from yet. */
  const beginStroke = useCallback((index: number, paint: (cellIndex: number) => void) => {
    isDrawingRef.current = true;
    lastPaintedRef.current = index;
    paint(index);
  }, []);

  /**
   * A pointer touched or moved over a cell.
   *
   * One handler for mouse, pen and finger, resolved from the grid's geometry
   * (see `TeletextGrid`'s `onPointerCell`). It replaced a set of per-cell mouse
   * handlers that a touch drag never fired: the browser sends every event of a
   * touch drag to the element the finger landed on, so the cells it passes over
   * are never entered, and painting on a phone was impossible.
   */
  const handlePointerCell = useCallback(
    (index: number, part: number, e: React.PointerEvent, phase: 'down' | 'move') => {
      // The header row is not editable, and a stroke crossing it steps over.
      if (index < COLS) {
        if (phase === 'down') return;
        setHoveredCellIndex(null);
        setHoveredPartIndex(null);
        return;
      }

      const alt = e.altKey;
      const drawing = isDrawingRef.current;

      if (brushMode === 'picker') {
        setHoveredCellIndex(index);
        // Nothing to drag: picking is a single act, on the way down.
        if (phase === 'down') pickFromCell(index);
        return;
      }

      if (brushMode === 'block') {
        setHoveredCellIndex(index);
        if (phase === 'down') {
          // Alt is "pick up the motif under the pointer", not "paint with it".
          if (alt) {
            pickMotifFromCell(index);
            return;
          }
          beginStroke(index, paintCell);
        } else if (drawing) {
          paintAlong(index, paintCell);
        }
        return;
      }

      if (brushMode === 'pixel') {
        setHoveredCellIndex(index);
        setHoveredPartIndex(part);
        if (phase === 'down') {
          beginStroke(index, (cell) => paintSixelPart(cell, part, alt));
        } else if (drawing) {
          paintAlong(index, (cell) => paintSixelPart(cell, part, alt));
        }
        return;
      }

      if (brushMode === 'blink') {
        const on = !alt;
        if (phase === 'down') {
          beginStroke(index, (cell) => paintBlinkCell(cell, on));
        } else if (drawing) {
          paintAlong(index, (cell) => paintBlinkCell(cell, true));
        }
        return;
      }

      // Typing: the pointer places the cursor and opens the keyboard, which on
      // a phone is the only way to raise it at all.
      if (phase === 'down') {
        setCursorIndex(index);
        focusHiddenInput();
      }
    },
    [
      brushMode,
      beginStroke,
      paintAlong,
      paintCell,
      paintBlinkCell,
      paintSixelPart,
      pickMotifFromCell,
      pickFromCell,
      focusHiddenInput,
      setCursorIndex,
    ],
  );

  /**
   * The stroke is over: the pointer was lifted, or capture was taken away.
   *
   * The hover marks go with it — on a touch screen there is no pointer resting
   * anywhere between strokes, so leaving them lit would mark a cell nobody is
   * pointing at.
   */
  const endStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPaintedRef.current = null;
    setHoveredCellIndex(null);
    setHoveredPartIndex(null);
  }, []);

  const handleGridMouseLeave = useCallback(() => {
    setHoveredCellIndex(null);
    setHoveredPartIndex(null);
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      isDrawingRef.current = false;
      // The next stroke starts wherever it starts; interpolating from the end of
      // the last one would draw a line across the page between them.
      lastPaintedRef.current = null;
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  useEffect(() => {
    if (!colorTooltipOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sixelColorTooltipRef.current?.contains(target)) return;
      setColorTooltipOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColorTooltipOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [colorTooltipOpen]);

  const setCellChar = useCallback(
    (index: number, char: string): boolean => {
      if (index < COLS) return false;
      const c = getFirstGrapheme(char) || " ";
      const row = Math.floor(index / COLS);
      // Double height only takes visual effect within the valid row range (not
      // the header row or the last row, which has no row below to span into);
      // outside it, typing never sets the flag, so there's nothing to un-set
      // later.
      const applyDoubleHeight =
        doubleHeightOn &&
        row >= MIN_DOUBLE_HEIGHT_ROW &&
        row <= MAX_DOUBLE_HEIGHT_ROW;
      writeCell(index, {
        ...page[index],
        char: c,
        fg,
        bg,
        graphics: null,
        doubleHeight: applyDoubleHeight,
      });
      if (applyDoubleHeight) {
        // The row directly below is now covered by this glyph. Clear it so
        // nothing stale reappears if double height is later turned off there.
        writeCell(index + COLS, emptyCellValue());
      }
      // Remembered on use rather than on choosing a colour: a style is only worth
      // recalling once it has actually been typed with, and recording every
      // half-made pair as the member clicks through the palette would fill the
      // strip with combinations nobody used.
      rememberTextStyle({ fg, bg, doubleHeight: applyDoubleHeight });
      return applyDoubleHeight;
    },
    [fg, bg, doubleHeightOn, writeCell, page, rememberTextStyle],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.key === "c" || e.key === "a") return;
        e.preventDefault();
        return;
      }
      const { col, row } = rowColFromIndex(cursorIndex);
      switch (e.key) {
        case "Backspace":
          e.preventDefault();
          writeCell(cursorIndex, {
            ...page[cursorIndex],
            char: " ",
            fg: "black",
            bg: "black",
            graphics: null,
            blink: false,
            doubleHeight: false,
          });
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.max(COLS, cursorIndex - 1), -1),
          );
          return;
        case "Delete":
          e.preventDefault();
          setCellChar(cursorIndex, " ");
          return;
        case "ArrowLeft":
          e.preventDefault();
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.max(COLS, cursorIndex - 1), -1),
          );
          return;
        case "ArrowRight":
          e.preventDefault();
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, cursorIndex + 1), 1),
          );
          return;
        case "ArrowUp":
          e.preventDefault();
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.max(COLS, indexAt(col, row - 1)), -COLS),
          );
          return;
        case "ArrowDown":
          e.preventDefault();
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, indexAt(col, row + 1)), COLS),
          );
          return;
        case "Enter":
          e.preventDefault();
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, indexAt(0, row + 1)), COLS),
          );
          return;
        case "Tab": {
          e.preventDefault();
          const tabStep = e.shiftKey ? -1 : 1;
          setCursorIndex(
            resolveDoubleHeightCursor(
              page,
              Math.max(COLS, Math.min(ROWS * COLS - 1, cursorIndex + tabStep)),
              tabStep,
            ),
          );
          return;
        }
        case "[":
        case "]":
          // Step through recent brushes. Only while a brush is active, so the
          // brackets stay typeable in text mode.
          if (brushMode !== "off" && brushes.history.length > 0) {
            e.preventDefault();
            stepBrushHistory(e.key === "[" ? 1 : -1);
            return;
          }
          if (brushMode !== "off") {
            e.preventDefault();
            return;
          }
          return;
        default:
          if (brushMode !== "off") {
            e.preventDefault();
            return;
          }
          if (e.key === "Dead" || e.key.length === 1) {
            return;
          }
          e.preventDefault();
      }
    },
    [
      cursorIndex,
      setCellChar,
      writeCell,
      page,
      setCursorIndex,
      brushMode,
      brushes.history.length,
      stepBrushHistory,
    ],
  );

  const handleHiddenInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      if (brushMode !== "off") return;
      const input = e.currentTarget;
      const value = input.value;
      if (!value) return;
      if (isDeadKeyOrCombiningOnly(value)) return;
      const c = getFirstGrapheme(value);
      if (c) {
        const wasDoubleHeight = setCellChar(cursorIndex, c);
        const { col, row } = rowColFromIndex(cursorIndex);
        const rawNext = Math.min(ROWS * COLS - 1, cursorIndex + 1);
        // Wrapping off the last column of a row we just made double-height:
        // skip the now-covered row below directly, rather than looking it up
        // via `page` — which, typing quickly, can still be a keystroke or two
        // behind the writes just made above (see `resolveDoubleHeightCursor`'s
        // doc comment for why that lookup alone isn't reliable here).
        const next =
          col === COLS - 1 && wasDoubleHeight
            ? Math.min(ROWS * COLS - 1, indexAt(0, row + 2))
            : resolveDoubleHeightCursor(page, rawNext, 1);
        setCursorIndex(next);
      }
      input.value = "";
    },
    [brushMode, cursorIndex, setCellChar, setCursorIndex, page],
  );

  const isBrushActive = brushMode !== "off";

  useEffect(() => {
    hiddenInputRef.current?.focus();
    const id = setTimeout(() => hiddenInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  const handleGridBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Don't reclaim focus when the user is moving to another interactive
    // control (e.g. the sidebar's page-number / title inputs or buttons);
    // otherwise the hidden grid input would immediately steal focus back and
    // those fields could never be typed into.
    const next = e.relatedTarget as HTMLElement | null;
    if (
      next &&
      (next.tagName === "INPUT" ||
        next.tagName === "TEXTAREA" ||
        next.tagName === "SELECT" ||
        next.tagName === "BUTTON" ||
        next.isContentEditable)
    ) {
      return;
    }
    setTimeout(() => hiddenInputRef.current?.focus(), 0);
  }, []);

  /*
   * Which shell to draw.
   *
   * A phone has no room beside the page, so the tools cannot sit next to it.
   * Below 900px the page takes the screen, the brushes go in a dock under the
   * thumb, and the rest lives in a sheet that pulls up when it is wanted.
   */
  const isNarrow = useMediaQuery("(max-width: 900px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Choosing a brush should not leave the sheet sitting over the page you are
  // about to draw on.
  const chooseBrushMode = useCallback((mode: typeof brushMode) => {
    setBrushMode(mode);
    setSheetOpen(false);
  }, []);


  /*
   * One set of controls, placed in one of two shells.
   *
   * Built here rather than inline in each layout so the phone and the desktop
   * cannot drift apart: a control added to one is added to both, because there
   * is only one of it.
   */
  const textStyleSection = (
    <section className="sidebar-section">
      <h2 className="sidebar-heading">Text style</h2>
      <div className="text-preview-three-col">
        <div className="text-preview-col">
          <span className="text-preview-label">Fg</span>
          <div className="text-preview-swatches text-preview-swatches-4x4">
            {TELETEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch color-swatch-mini teletext-bg-${color} ${fg === color ? "active" : ""}`}
                title={`Foreground ${color}`}
                onClick={() => setFg(color)}
                aria-label={`Foreground ${color}`}
              />
            ))}
          </div>
        </div>
        <div className="text-preview-col">
          <span className="text-preview-label">Bg</span>
          <div className="text-preview-swatches text-preview-swatches-4x4">
            {TELETEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch color-swatch-mini teletext-bg-${color} ${bg === color ? "active" : ""}`}
                title={`Background ${color}`}
                onClick={() => setBg(color)}
                aria-label={`Background ${color}`}
              />
            ))}
          </div>
        </div>
        <div
          className={`text-preview-cell teletext-fg-${fg} teletext-bg-${bg} ${doubleHeightOn ? "text-preview-cell-double-height" : ""}`}
          aria-hidden
        />
      </div>
      <button
        type="button"
        className={`sidebar-toggle ${doubleHeightOn ? "active" : ""}`}
        onClick={() => setDoubleHeightOn((v) => !v)}
        aria-pressed={doubleHeightOn}
        title="Typed characters render at twice the row height. Not available on the last row."
      >
        <IconDoubleHeight className="sidebar-toggle-icon" />
        <span>Double height</span>
      </button>

      {textStyles.history.length > 0 && (
        <div className="color-block brush-history">
          <span className="sidebar-field-label">Recent text styles</span>
          <div className="brush-history-stepper">
            <button
              type="button"
              className="brush-history-step"
              onClick={() => stepTextStyleHistory(1)}
              disabled={textStyles.index >= textStyles.history.length - 1}
              title="Older text style"
              aria-label="Older text style"
            >
              ◀
            </button>
            <span className="brush-history-current">
              <TextStyleSwatch style={textStyles.history[textStyles.index]} />
            </span>
            <button
              type="button"
              className="brush-history-step"
              onClick={() => stepTextStyleHistory(-1)}
              disabled={textStyles.index <= 0}
              title="Newer text style"
              aria-label="Newer text style"
            >
              ▶
            </button>
          </div>
          <div className="brush-history-strip">
            {textStyles.history.map((style, idx) => (
              <button
                key={textStyleKey(style)}
                type="button"
                className={`brush-history-btn ${idx === textStyles.index ? "brush-history-btn-active" : ""}`}
                title={describeTextStyle(style)}
                onClick={() => selectTextStyleFromHistory(idx)}
                aria-label={`Use recent text style ${idx + 1}: ${describeTextStyle(style)}`}
                aria-pressed={idx === textStyles.index}
              >
                <TextStyleSwatch style={style} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  const brushOptionsSection = (
    <section className="sidebar-section">
      <h2 className="sidebar-heading">Brush options</h2>
        {brushMode === "picker" && (
          <p className="sidebar-hint">
            Click any cell to copy what made it. A cell with a character hands
            its colours to the text tool and puts the cursor there; a mosaic
            cell hands its shape and its six colours to the block brush.
          </p>
        )}
        {brushMode === "block" && (
          <div className="brush-options">
            {/*
              * A lifted shape is otherwise invisible state: the motif previews
              * all show full cells, so a half-filled brush would look identical
              * to a solid one right up until it painted.
              */}
            {blockPattern !== SIXEL_MAX && (
              <div className="brush-picked-pattern">
                <div className="brush-picked-preview" aria-hidden>
                  {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                    <span
                      key={i}
                      className={`preset-motif-dot teletext-bg-${
                        sixelBit(blockPattern, i) ? brushColors[i] : "black"
                      }`}
                    />
                  ))}
                </div>
                <div className="brush-picked-text">
                  <span className="sidebar-field-label">Picked shape</span>
                  <button
                    type="button"
                    className="sidebar-toggle"
                    onClick={() => setBlockPattern(SIXEL_MAX)}
                  >
                    <span>Fill the whole cell</span>
                  </button>
                </div>
              </div>
            )}
            <div className="color-block">
              <div className="preset-motifs">
                {MOTIF_PATTERNS.map((pattern, idx) => {
                  const previewColors =
                    motifColors[idx] ?? defaultColorsForMotif(pattern.slots);
                  return (
                    <button
                      key={pattern.name}
                      type="button"
                      className={`preset-motif-btn ${selectedMotifIndex === idx ? "preset-motif-btn-active" : ""}`}
                      title={pattern.name}
                      onClick={() => selectMotif(idx)}
                      aria-label={`Use ${pattern.name} motif`}
                      aria-pressed={selectedMotifIndex === idx}
                    >
                      <div className="preset-motif-preview">
                        {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                          <span
                            key={i}
                            className={`preset-motif-dot teletext-bg-${previewColors[i]}`}
                          />
                        ))}
                      </div>
                      <span className="preset-motif-name">
                        {pattern.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div
                className="color-block sixel-color-tooltip-ref"
                ref={sixelColorTooltipRef}
              >
                <span className="sidebar-field-label">
                  Click a part to change its color
                </span>
                <div
                  className="brush-sixel-preview"
                  ref={brushSixelPreviewRef}
                  aria-hidden
                >
                  {([0, 1, 2, 3, 4, 5] as const).map((i) => {
                    const slotIndex = selectedMotif.slots[i];
                    const slots = selectedMotif.slots;
                    /* Grid is 2×3 row-major: [0][1] / [2][3] / [4][5]. Right = i+1 when left col; bottom = i+2 when row 0 or 1. */
                    const rightNeighbor = i % 2 === 0 && i < 5 ? i + 1 : null;
                    const bottomNeighbor = i <= 3 ? i + 2 : null;
                    const borderRight =
                      rightNeighbor !== null &&
                      slots[i] !== slots[rightNeighbor];
                    const borderBottom =
                      bottomNeighbor !== null &&
                      slots[i] !== slots[bottomNeighbor];
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`brush-sixel-part brush-sixel-part-slot-${slotIndex} teletext-bg-${brushColors[i]} ${borderRight ? "brush-sixel-part-border-r" : ""} ${borderBottom ? "brush-sixel-part-border-b" : ""} ${hoveredSlotIndex === slotIndex ? "brush-sixel-part-hover" : ""} ${selectedSixelIndex === i && colorTooltipOpen ? "brush-sixel-part-active" : ""}`}
                        title={`Part ${i + 1}`}
                        onMouseEnter={() => setHoveredSlotIndex(slotIndex)}
                        onMouseLeave={() => setHoveredSlotIndex(null)}
                        onClick={(e) => {
                          const open =
                            colorTooltipOpen && selectedSixelIndex === i
                              ? false
                              : true;
                          setSelectedSixelIndex(i);
                          if (open && brushSixelPreviewRef.current) {
                            const partRect = (
                              e.currentTarget as HTMLButtonElement
                            ).getBoundingClientRect();
                            const previewRect =
                              brushSixelPreviewRef.current.getBoundingClientRect();
                            setTooltipAnchor({
                              part: {
                                left: partRect.left,
                                top: partRect.top,
                                width: partRect.width,
                                height: partRect.height,
                              },
                              preview: {
                                left: previewRect.left,
                                top: previewRect.top,
                                width: previewRect.width,
                                height: previewRect.height,
                              },
                            });
                          }
                          setColorTooltipOpen(open);
                        }}
                        aria-label={`Part ${i + 1}, ${brushColors[i]}`}
                        aria-expanded={
                          selectedSixelIndex === i && colorTooltipOpen
                        }
                      />
                    );
                  })}
                </div>
                {(() => {
                  const clamped = tooltipAnchor
                    ? clampTooltipToViewport(tooltipAnchor)
                    : null;
                  const slotCount = motifSlotCount(selectedMotif.slots);
                  const tooltipLabel =
                    slotCount === 1
                      ? "Color"
                      : SIXEL_PART_NAMES[selectedSixelIndex];
                  return (
                    <div
                      className={`sixel-color-tooltip ${colorTooltipOpen ? "sixel-color-tooltip-open" : ""}`}
                      role="tooltip"
                      aria-hidden={!colorTooltipOpen}
                      style={{
                        position: "fixed",
                        left: clamped ? clamped.left : -9999,
                        top: clamped ? clamped.top : 0,
                      }}
                    >
                      <div
                        className="sixel-color-tooltip-label"
                        aria-live="polite"
                      >
                        {tooltipLabel}
                      </div>
                      <div className="sixel-color-tooltip-swatches">
                        {TELETEXT_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`color-swatch teletext-bg-${color}`}
                            title={color}
                            onClick={() => {
                              const slotIndex =
                                selectedMotif.slots[selectedSixelIndex];
                              setMotifSlotColor(slotIndex, color);
                              setColorTooltipOpen(false);
                            }}
                            aria-label={`Set to ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="color-block">
              <span className="sidebar-field-label">
                Pick from grid (Alt + click)
              </span>
              <p className="sidebar-hint">
                Hold Alt and click a block on the grid to copy its motif.
              </p>
            </div>
          </div>
        )}
        {brushMode === "pixel" && (
          <div className="brush-options">
            <div className="color-block">
              <span className="sidebar-field-label">Pixel color</span>
              <div className="text-preview-swatches text-preview-swatches-4x4">
                {TELETEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch color-swatch-mini teletext-bg-${color} ${pixelColor === color ? "active" : ""}`}
                    title={`Pixel ${color}`}
                    onClick={() => setPixelColor(color)}
                    aria-label={`Pixel color ${color}`}
                    aria-pressed={pixelColor === color}
                  />
                ))}
              </div>
            </div>
            <p className="sidebar-hint">
              Click a sixth of a cell to paint just that sixth. Drag to keep
              painting. Alt + click erases a sixth.
            </p>
          </div>
        )}
        {brushMode === "blink" && (
          <p className="sidebar-hint">
            Click or drag to set blink on. Alt + click to remove blink.
          </p>
        )}
        {isBrushActive && brushes.history.length > 0 && (
          <div className="color-block brush-history">
            <span className="sidebar-field-label">Recent brushes</span>
            <div className="brush-history-stepper">
              <button
                type="button"
                className="brush-history-step"
                onClick={() => stepBrushHistory(1)}
                disabled={brushes.index >= brushes.history.length - 1}
                title="Older brush ( [ )"
                aria-label="Older brush"
              >
                ◀
              </button>
              <span className="brush-history-current">
                <BrushSwatch brush={brushes.history[brushes.index]} />
              </span>
              <button
                type="button"
                className="brush-history-step"
                onClick={() => stepBrushHistory(-1)}
                disabled={brushes.index <= 0}
                title="Newer brush ( ] )"
                aria-label="Newer brush"
              >
                ▶
              </button>
            </div>
            <div className="brush-history-strip">
              {brushes.history.map((brush, idx) => (
                <button
                  key={brushKey(brush)}
                  type="button"
                  className={`brush-history-btn ${idx === brushes.index ? "brush-history-btn-active" : ""}`}
                  title={
                    brush.kind === "pixel"
                      ? `Pixel brush (${brush.color})`
                      : `${MOTIF_PATTERNS[brush.motifIndex]?.name ?? "Block"} brush`
                  }
                  onClick={() => selectBrushFromHistory(idx)}
                  aria-label={`Use recent brush ${idx + 1}`}
                  aria-pressed={idx === brushes.index}
                >
                  <BrushSwatch brush={brush} />
                </button>
              ))}
            </div>
          </div>
        )}

    </section>
  );

  const brushSection = (
    <section className="sidebar-section">
      <h2 className="sidebar-heading">Brush</h2>
        <div className="brush-mode-toggles">
          <button
            type="button"
            className={`sidebar-toggle ${brushMode === "off" ? "active" : ""}`}
            onClick={() => setBrushMode("off")}
            title="Type text"
          >
            <IconTextCursor className="sidebar-toggle-icon" />
            <span>Off</span>
          </button>
          <button
            type="button"
            className={`sidebar-toggle ${brushMode === "block" ? "active" : ""}`}
            onClick={() => setBrushMode("block")}
            title="Paint whole mosaic cells with a motif"
          >
            <IconBlock className="sidebar-toggle-icon" />
            <span>Block</span>
          </button>
          <button
            type="button"
            className={`sidebar-toggle ${brushMode === "pixel" ? "active" : ""}`}
            onClick={() => setBrushMode("pixel")}
            title="Paint a single sixth of a cell. Alt+click to erase it."
          >
            <IconPixel className="sidebar-toggle-icon" />
            <span>Pixel</span>
          </button>
          <button
            type="button"
            className={`sidebar-toggle ${brushMode === "blink" ? "active" : ""}`}
            onClick={() => setBrushMode("blink")}
            title="Paint blink on cells. Alt+click to remove blink."
          >
            <IconBlink className="sidebar-toggle-icon" />
            <span>Blink</span>
          </button>
          <button
            type="button"
            className={`sidebar-toggle ${brushMode === "picker" ? "active" : ""}`}
            onClick={() => setBrushMode("picker")}
            title="Click a cell to copy what made it: its colours if it holds a character, its shape and colours if it is a mosaic."
          >
            <IconPipette className="sidebar-toggle-icon" />
            <span>Pick</span>
          </button>
        </div>
      {brushMode === "picker" && (
        <p className="sidebar-hint">
          Click any cell to copy what made it. A cell with a character hands
          its colours to the text tool and puts the cursor there; a mosaic
          cell hands its shape and its six colours to the block brush.
        </p>
      )}
      {brushMode === "block" && (
        <div className="brush-options">
          {/*
            * A lifted shape is otherwise invisible state: the motif previews
            * all show full cells, so a half-filled brush would look identical
            * to a solid one right up until it painted.
            */}
          {blockPattern !== SIXEL_MAX && (
            <div className="brush-picked-pattern">
              <div className="brush-picked-preview" aria-hidden>
                {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                  <span
                    key={i}
                    className={`preset-motif-dot teletext-bg-${
                      sixelBit(blockPattern, i) ? brushColors[i] : "black"
                    }`}
                  />
                ))}
              </div>
              <div className="brush-picked-text">
                <span className="sidebar-field-label">Picked shape</span>
                <button
                  type="button"
                  className="sidebar-toggle"
                  onClick={() => setBlockPattern(SIXEL_MAX)}
                >
                  <span>Fill the whole cell</span>
                </button>
              </div>
            </div>
          )}
          <div className="color-block">
            <div className="preset-motifs">
              {MOTIF_PATTERNS.map((pattern, idx) => {
                const previewColors =
                  motifColors[idx] ?? defaultColorsForMotif(pattern.slots);
                return (
                  <button
                    key={pattern.name}
                    type="button"
                    className={`preset-motif-btn ${selectedMotifIndex === idx ? "preset-motif-btn-active" : ""}`}
                    title={pattern.name}
                    onClick={() => selectMotif(idx)}
                    aria-label={`Use ${pattern.name} motif`}
                    aria-pressed={selectedMotifIndex === idx}
                  >
                    <div className="preset-motif-preview">
                      {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                        <span
                          key={i}
                          className={`preset-motif-dot teletext-bg-${previewColors[i]}`}
                        />
                      ))}
                    </div>
                    <span className="preset-motif-name">
                      {pattern.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="color-block sixel-color-tooltip-ref"
              ref={sixelColorTooltipRef}
            >
              <span className="sidebar-field-label">
                Click a part to change its color
              </span>
              <div
                className="brush-sixel-preview"
                ref={brushSixelPreviewRef}
                aria-hidden
              >
                {([0, 1, 2, 3, 4, 5] as const).map((i) => {
                  const slotIndex = selectedMotif.slots[i];
                  const slots = selectedMotif.slots;
                  /* Grid is 2×3 row-major: [0][1] / [2][3] / [4][5]. Right = i+1 when left col; bottom = i+2 when row 0 or 1. */
                  const rightNeighbor = i % 2 === 0 && i < 5 ? i + 1 : null;
                  const bottomNeighbor = i <= 3 ? i + 2 : null;
                  const borderRight =
                    rightNeighbor !== null &&
                    slots[i] !== slots[rightNeighbor];
                  const borderBottom =
                    bottomNeighbor !== null &&
                    slots[i] !== slots[bottomNeighbor];
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`brush-sixel-part brush-sixel-part-slot-${slotIndex} teletext-bg-${brushColors[i]} ${borderRight ? "brush-sixel-part-border-r" : ""} ${borderBottom ? "brush-sixel-part-border-b" : ""} ${hoveredSlotIndex === slotIndex ? "brush-sixel-part-hover" : ""} ${selectedSixelIndex === i && colorTooltipOpen ? "brush-sixel-part-active" : ""}`}
                      title={`Part ${i + 1}`}
                      onMouseEnter={() => setHoveredSlotIndex(slotIndex)}
                      onMouseLeave={() => setHoveredSlotIndex(null)}
                      onClick={(e) => {
                        const open =
                          colorTooltipOpen && selectedSixelIndex === i
                            ? false
                            : true;
                        setSelectedSixelIndex(i);
                        if (open && brushSixelPreviewRef.current) {
                          const partRect = (
                            e.currentTarget as HTMLButtonElement
                          ).getBoundingClientRect();
                          const previewRect =
                            brushSixelPreviewRef.current.getBoundingClientRect();
                          setTooltipAnchor({
                            part: {
                              left: partRect.left,
                              top: partRect.top,
                              width: partRect.width,
                              height: partRect.height,
                            },
                            preview: {
                              left: previewRect.left,
                              top: previewRect.top,
                              width: previewRect.width,
                              height: previewRect.height,
                            },
                          });
                        }
                        setColorTooltipOpen(open);
                      }}
                      aria-label={`Part ${i + 1}, ${brushColors[i]}`}
                      aria-expanded={
                        selectedSixelIndex === i && colorTooltipOpen
                      }
                    />
                  );
                })}
              </div>
              {(() => {
                const clamped = tooltipAnchor
                  ? clampTooltipToViewport(tooltipAnchor)
                  : null;
                const slotCount = motifSlotCount(selectedMotif.slots);
                const tooltipLabel =
                  slotCount === 1
                    ? "Color"
                    : SIXEL_PART_NAMES[selectedSixelIndex];
                return (
                  <div
                    className={`sixel-color-tooltip ${colorTooltipOpen ? "sixel-color-tooltip-open" : ""}`}
                    role="tooltip"
                    aria-hidden={!colorTooltipOpen}
                    style={{
                      position: "fixed",
                      left: clamped ? clamped.left : -9999,
                      top: clamped ? clamped.top : 0,
                    }}
                  >
                    <div
                      className="sixel-color-tooltip-label"
                      aria-live="polite"
                    >
                      {tooltipLabel}
                    </div>
                    <div className="sixel-color-tooltip-swatches">
                      {TELETEXT_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`color-swatch teletext-bg-${color}`}
                          title={color}
                          onClick={() => {
                            const slotIndex =
                              selectedMotif.slots[selectedSixelIndex];
                            setMotifSlotColor(slotIndex, color);
                            setColorTooltipOpen(false);
                          }}
                          aria-label={`Set to ${color}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="color-block">
            <span className="sidebar-field-label">
              Pick from grid (Alt + click)
            </span>
            <p className="sidebar-hint">
              Hold Alt and click a block on the grid to copy its motif.
            </p>
          </div>
        </div>
      )}
      {brushMode === "pixel" && (
        <div className="brush-options">
          <div className="color-block">
            <span className="sidebar-field-label">Pixel color</span>
            <div className="text-preview-swatches text-preview-swatches-4x4">
              {TELETEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch color-swatch-mini teletext-bg-${color} ${pixelColor === color ? "active" : ""}`}
                  title={`Pixel ${color}`}
                  onClick={() => setPixelColor(color)}
                  aria-label={`Pixel color ${color}`}
                  aria-pressed={pixelColor === color}
                />
              ))}
            </div>
          </div>
          <p className="sidebar-hint">
            Click a sixth of a cell to paint just that sixth. Drag to keep
            painting. Alt + click erases a sixth.
          </p>
        </div>
      )}
      {brushMode === "blink" && (
        <p className="sidebar-hint">
          Click or drag to set blink on. Alt + click to remove blink.
        </p>
      )}
      {isBrushActive && brushes.history.length > 0 && (
        <div className="color-block brush-history">
          <span className="sidebar-field-label">Recent brushes</span>
          <div className="brush-history-stepper">
            <button
              type="button"
              className="brush-history-step"
              onClick={() => stepBrushHistory(1)}
              disabled={brushes.index >= brushes.history.length - 1}
              title="Older brush ( [ )"
              aria-label="Older brush"
            >
              ◀
            </button>
            <span className="brush-history-current">
              <BrushSwatch brush={brushes.history[brushes.index]} />
            </span>
            <button
              type="button"
              className="brush-history-step"
              onClick={() => stepBrushHistory(-1)}
              disabled={brushes.index <= 0}
              title="Newer brush ( ] )"
              aria-label="Newer brush"
            >
              ▶
            </button>
          </div>
          <div className="brush-history-strip">
            {brushes.history.map((brush, idx) => (
              <button
                key={brushKey(brush)}
                type="button"
                className={`brush-history-btn ${idx === brushes.index ? "brush-history-btn-active" : ""}`}
                title={
                  brush.kind === "pixel"
                    ? `Pixel brush (${brush.color})`
                    : `${MOTIF_PATTERNS[brush.motifIndex]?.name ?? "Block"} brush`
                }
                onClick={() => selectBrushFromHistory(idx)}
                aria-label={`Use recent brush ${idx + 1}`}
                aria-pressed={idx === brushes.index}
              >
                <BrushSwatch brush={brush} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>

  );

  const actionsSection = (
    <section className="sidebar-section sidebar-actions">
      {onBackToGrid != null && (
        <button
          type="button"
          className="sidebar-action-btn"
          onClick={() => {
            void onBackToGrid();
          }}
        >
          <IconBack className="sidebar-toggle-icon" />
          <span>Back to grid</span>
        </button>
      )}
      <button
        type="button"
        className="sidebar-action-btn"
        onClick={() =>
          exportPageAsPng(page, "teletext.png", pageNumber ?? 100)
        }
      >
        <IconExport className="sidebar-toggle-icon" />
        <span>Export PNG</span>
      </button>
      {clearConfirmShown ? (
        <div className="clear-confirm">
          <span className="clear-confirm-label">Are you sure?</span>
          <div className="clear-confirm-buttons">
            <button
              type="button"
              className="sidebar-action-btn sidebar-action-btn-clear"
              onClick={() => {
                clearPage();
                setClearConfirmShown(false);
              }}
            >
              Yes, clear
            </button>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => setClearConfirmShown(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="sidebar-action-btn sidebar-action-btn-clear"
          onClick={() => setClearConfirmShown(true)}
        >
          <IconTrash className="sidebar-toggle-icon" />
          <span>Clear page</span>
        </button>
      )}
    </section>
  );

  const grid = (
    <div className="editor-main">
    <div
      ref={gridRef}
      className={`teletext-screen-wrapper${
        brushMode === "picker"
          ? " picker-cursor"
          : isBrushActive
            ? " brush-cursor"
            : ""
      }`}
      tabIndex={0}
      onFocus={focusHiddenInput}
      onBlur={handleGridBlur}
      onMouseLeave={handleGridMouseLeave}
      role="application"
      aria-label="Teletext editor grid"
    >
      <input
        ref={hiddenInputRef}
        type="text"
        className="editor-hidden-input"
        aria-hidden
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onInput={handleHiddenInput}
      />
      <TeletextGrid
        page={page}
        pageNumber={pageNumber ?? 100}
        subpage={subpage}
        subpageCount={subpageCount}
        cursorIndex={isBrushActive ? hoveredCellIndex : cursorIndex}
        hoverPartIndex={brushMode === "pixel" ? hoveredPartIndex : null}
        cursorDoubleHeight={brushMode === "off" && doubleHeightOn}
        onPointerCell={handlePointerCell}
        onPointerEnd={endStroke}
        readOnly={false}
      />
      {remoteCursors && remoteCursors.length > 0 && (
        <div
          className="editor-remote-cursors"
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            fontSize: "14px",
          }}
        >
          {remoteCursors.map((rc) => {
            const { col, row } = rowColFromIndex(rc.index);
            const color = resolveCursorColor(rc.color);
            return (
              <div
                key={`${rc.name}-${rc.index}`}
                className="editor-remote-cursor"
                style={{
                  position: "absolute",
                  left: `calc(14px + ${col} * 1em)`,
                  top: `calc(14px + ${row} * 1.35em)`,
                  width: "1em",
                  height: "1.35em",
                  outline: `2px solid ${color}`,
                  outlineOffset: "-2px",
                  boxSizing: "border-box",
                }}
              >
                <span
                  className="editor-remote-cursor-label"
                  style={{
                    position: "absolute",
                    top: "-1em",
                    left: 0,
                    fontSize: "0.5em",
                    lineHeight: 1,
                    background: color,
                    color: "#000",
                    padding: "1px 2px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {rc.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );

  if (isNarrow) {
    return (
      <div className="editor-layout editor-layout-narrow">
        {/* The page, with nothing competing for the screen. */}
        {grid}

        {/*
          * The dock: five brushes, always under the thumb, and the handle that
          * raises everything else. Choosing a brush is most of what editing is,
          * and a tool you have to go looking for is a tool you stop using.
          */}
        <div className="editor-dock">
            <div className="brush-mode-toggles">
              <button
                type="button"
                className={`sidebar-toggle ${brushMode === "off" ? "active" : ""}`}
                onClick={() => chooseBrushMode("off")}
                title="Type text"
              >
                <IconTextCursor className="sidebar-toggle-icon" />
                <span>Off</span>
              </button>
              <button
                type="button"
                className={`sidebar-toggle ${brushMode === "block" ? "active" : ""}`}
                onClick={() => chooseBrushMode("block")}
                title="Paint whole mosaic cells with a motif"
              >
                <IconBlock className="sidebar-toggle-icon" />
                <span>Block</span>
              </button>
              <button
                type="button"
                className={`sidebar-toggle ${brushMode === "pixel" ? "active" : ""}`}
                onClick={() => chooseBrushMode("pixel")}
                title="Paint a single sixth of a cell. Alt+click to erase it."
              >
                <IconPixel className="sidebar-toggle-icon" />
                <span>Pixel</span>
              </button>
              <button
                type="button"
                className={`sidebar-toggle ${brushMode === "blink" ? "active" : ""}`}
                onClick={() => chooseBrushMode("blink")}
                title="Paint blink on cells. Alt+click to remove blink."
              >
                <IconBlink className="sidebar-toggle-icon" />
                <span>Blink</span>
              </button>
              <button
                type="button"
                className={`sidebar-toggle ${brushMode === "picker" ? "active" : ""}`}
                onClick={() => chooseBrushMode("picker")}
                title="Click a cell to copy what made it: its colours if it holds a character, its shape and colours if it is a mosaic."
              >
                <IconPipette className="sidebar-toggle-icon" />
                <span>Pick</span>
              </button>
            </div>
          <button
            type="button"
            className="editor-sheet-handle"
            aria-expanded={sheetOpen}
            aria-controls="editor-sheet"
            onClick={() => setSheetOpen((open) => !open)}
          >
            {sheetOpen ? "Close" : "Tools"}
          </button>
        </div>

        {sheetOpen && (
          <>
            {/* Tapping the page closes the sheet — the gesture people try
                first, and the only one that needs no explaining. */}
            <div
              className="editor-sheet-scrim"
              onClick={() => setSheetOpen(false)}
              aria-hidden="true"
            />
            <div
              id="editor-sheet"
              className="editor-sheet"
              role="dialog"
              aria-label="Tools"
            >
              {sidebarHeader}
              {textStyleSection}
              {brushOptionsSection}
              {actionsSection}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar">
        <h1 className="editor-title">TELETEXT EDITOR</h1>

        {sidebarHeader}

        {textStyleSection}

        {brushSection}

        {actionsSection}
      </aside>

      {grid}
    </div>
  );
}
