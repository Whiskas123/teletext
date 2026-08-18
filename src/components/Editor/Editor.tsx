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
  IconPage,
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

/** Which tool the pointer is holding. */
type BrushMode = "off" | "block" | "pixel" | "blink" | "picker";

/**
 * Which panel is open under the tab strip.
 *
 * A tool and everything that configures it, or the page: which number is being
 * drawn on and what it is called. `"page"` is the one tab that is not a tool,
 * and choosing it deliberately does *not* put the tool down — you go there to
 * dial a page and come straight back to what you were drawing with.
 */
type ConsoleTab = "page" | BrushMode;

/**
 * The five tool keys, as data.
 *
 * The console and the handset are two shells for one set of controls, and the
 * keys are the part that was hardest to keep in step while each shell spelled
 * them out for itself — five buttons written twice is five chances to add a
 * tool to one and not the other. Written once here, both shells get the same
 * row in the same order, and a sixth tool is a line in this table.
 */
const BRUSH_KEYS: readonly {
  mode: BrushMode;
  label: string;
  title: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}[] = [
  {
    mode: "off",
    label: "Text",
    title: "Type text",
    Icon: IconTextCursor,
  },
  {
    mode: "block",
    label: "Block",
    title: "Paint whole mosaic cells with a motif",
    Icon: IconBlock,
  },
  {
    mode: "pixel",
    label: "Pixel",
    title: "Paint a single sixth of a cell. Alt+click to erase it.",
    Icon: IconPixel,
  },
  {
    mode: "blink",
    label: "Blink",
    title: "Paint blink on cells. Alt+click to remove blink.",
    Icon: IconBlink,
  },
  {
    mode: "picker",
    label: "Pick",
    title:
      "Click a cell to copy what made it: its colours if it holds a character, its shape and colours if it is a mosaic.",
    Icon: IconPipette,
  },
];

/**
 * The panel's own keyboard, in two layers of four rows.
 *
 * Ten slots to a row throughout, which is what lets the caps be one flexible
 * width and still line up: the third row is nine characters and a `⌫`, the
 * fourth is `⇧` and nine on the letter layer and ten accented vowels on the
 * symbol one. The accents are there because this is a Portuguese teletext
 * service and `á` is not a symbol here, it is a letter.
 */
const PAD_LETTERS = [
  "1234567890",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm,.",
] as const;

const PAD_SYMBOLS = [
  "1234567890",
  "!\"#$%&'()*",
  "+-/:;=?@£",
  "áéíóúàãõçê",
] as const;

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
  /** When set, renders a "Back to grid" key in the console actions that calls this. */
  onBackToGrid?: () => void | Promise<void>;
  /**
   * The nameplate along the top of the console: where the host puts its way out
   * of the editor and whatever lamp it wants lit.
   */
  brand?: import('react').ReactNode;
  /**
   * The host's page panel — its readout, its dialling, its title, its subpages.
   * Everything behind the strip's `Page` tab; supplied by the host, because only
   * the host knows what a page is here.
   */
  pageControls?: import('react').ReactNode;
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
  brand,
  pageControls,
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
  const [brushMode, setBrushMode] = useState<BrushMode>("off");
  /** Which panel the tab strip has open; see {@link ConsoleTab}. */
  const [tab, setTab] = useState<ConsoleTab>("off");
  /** Which layer the panel's keyboard is showing, and whether it is in caps. */
  const [padLayer, setPadLayer] = useState<"letters" | "symbols">("letters");
  const [padShift, setPadShift] = useState(true);
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
  /**
   * Take up a tool, and bring the panel with it.
   *
   * The strip is not just navigation — a tab *is* a tool — so anything that
   * changes the tool by another route has to move the strip too, or you end up
   * drawing mosaics while the panel shows you the text style. The eyedropper is
   * the case that matters: it becomes whichever tool made the cell it picked, so
   * lifting a mosaic should land you on Block with that mosaic's colours already
   * under your thumb, and lifting a character should land you on Text with its
   * style. Going through here is what makes that automatic rather than a `setTab`
   * somebody has to remember at each call site.
   */
  const holdTool = useCallback((mode: BrushMode) => {
    setBrushMode(mode);
    setTab(mode);
  }, []);

  const applyTextStyle = useCallback(
    (style: TextStyle) => {
      setFg(style.fg);
      setBg(style.bg);
      setDoubleHeightOn(style.doubleHeight);
      holdTool("off");
    },
    [holdTool],
  );

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
  const applyBrush = useCallback(
    (brush: Brush) => {
      if (brush.kind === "pixel") {
        setPixelColor(brush.color);
        holdTool("pixel");
        return;
      }
      setSelectedMotifIndex(brush.motifIndex);
      setMotifColors((prev) => {
        const n = [...prev];
        n[brush.motifIndex] = [...brush.colors] as SixelColors;
        return n;
      });
      setBlockPattern(brush.pattern);
      holdTool("block");
    },
    [holdTool],
  );

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
        holdTool("block");
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
      holdTool,
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

  /**
   * Put a character in the cell under the cursor and move on.
   *
   * Lifted out of the hidden input's handler so the panel's own keyboard can
   * type through exactly the same path — the double-height bookkeeping on the
   * wrap off the last column is subtle enough that a second copy of it would be
   * a second copy of a bug (see below).
   */
  const typeCharacter = useCallback(
    (char: string) => {
      const wasDoubleHeight = setCellChar(cursorIndex, char);
      const { col, row } = rowColFromIndex(cursorIndex);
      const rawNext = Math.min(ROWS * COLS - 1, cursorIndex + 1);
      // Wrapping off the last column of a row we just made double-height: skip
      // the now-covered row below directly, rather than looking it up via
      // `page` — which, typing quickly, can still be a keystroke or two behind
      // the writes just made above (see `resolveDoubleHeightCursor`'s doc
      // comment for why that lookup alone isn't reliable here).
      const next =
        col === COLS - 1 && wasDoubleHeight
          ? Math.min(ROWS * COLS - 1, indexAt(0, row + 2))
          : resolveDoubleHeightCursor(page, rawNext, 1);
      setCursorIndex(next);
    },
    [cursorIndex, setCellChar, page, setCursorIndex],
  );

  /**
   * The keys that only move the cursor or erase, by name.
   *
   * Shared between the physical keyboard and the panel's own, which is why it
   * takes a key name rather than an event: `⌫` on a moulded cap and Backspace on
   * a real one are the same key, and there is no reason for the editor to hold
   * two ideas of what it does. Returns whether the name was one of them.
   */
  const applyControlKey = useCallback(
    (key: string): boolean => {
      const { col, row } = rowColFromIndex(cursorIndex);
      switch (key) {
        case "Backspace":
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
          return true;
        case "Delete":
          setCellChar(cursorIndex, " ");
          return true;
        case "ArrowLeft":
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.max(COLS, cursorIndex - 1), -1),
          );
          return true;
        case "ArrowRight":
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, cursorIndex + 1), 1),
          );
          return true;
        case "ArrowUp":
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.max(COLS, indexAt(col, row - 1)), -COLS),
          );
          return true;
        case "ArrowDown":
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, indexAt(col, row + 1)), COLS),
          );
          return true;
        case "Enter":
          setCursorIndex(
            resolveDoubleHeightCursor(page, Math.min(ROWS * COLS - 1, indexAt(0, row + 1)), COLS),
          );
          return true;
        default:
          return false;
      }
    },
    [cursorIndex, page, setCellChar, setCursorIndex, writeCell],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.key === "c" || e.key === "a") return;
        e.preventDefault();
        return;
      }
      if (applyControlKey(e.key)) {
        e.preventDefault();
        return;
      }
      switch (e.key) {
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
      applyControlKey,
      cursorIndex,
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
      if (c) typeCharacter(c);
      input.value = "";
    },
    [brushMode, typeCharacter],
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
        next.tabIndex >= 0 ||
        next.isContentEditable)
    ) {
      return;
    }
    setTimeout(() => hiddenInputRef.current?.focus(), 0);
  }, []);

  /*
   * Which shell to draw.
   *
   * The controls are the television's own — moulded keys on a plastic panel,
   * an LED window, an aluminium strip between one cluster and the next — because
   * they work the same appliance as the remote on `/watch` does, and an editor
   * for teletext should not be the one screen in the app that looks like a form.
   * There is no cabinet here: a page being drawn is not a page being watched, so
   * the picture stands on its own and only the panel came across.
   *
   * A phone has no room beside the page, so the panel cannot sit next to it.
   * Below 900px the console is rebuilt as the handset it already resembles:
   * pinned under the picture, tool keys along its head where they are never
   * scrolled away from, and the rest of the panel scrolling beneath them.
   */
  const isNarrow = useMediaQuery("(max-width: 900px)");

  /*
   * One set of controls, in one of two shells.
   *
   * Built here rather than inline in each layout so the phone and the desktop
   * cannot drift apart: a control added to one is added to both, because there
   * is only one of it.
   */

  /**
   * The tab strip: the page, then the five tools.
   *
   * The same row on the console and on the handset, and the only navigation the
   * panel has — what is under it is whatever this row has open, and nothing
   * else. A brush's colours, its motifs and its history are its own; so is the
   * text style, which belongs to typing and to nothing else on this panel and
   * used to sit above all five tools as though it belonged to all of them.
   *
   * Page is set apart by a gap rather than by a different shape, the way a
   * moulded panel groups keys. Pressing it opens the page panel and leaves the
   * tool exactly where it was: the held tool keeps a lit pip in its corner so
   * you can see what you will still be drawing with when you come back.
   */
  const tabs = (
    <div className="rc-tabs" role="tablist" aria-label="Console">
      {pageControls != null && (
        <button
          type="button"
          role="tab"
          className={`rc-key rc-key-tool${tab === "page" ? " rc-key-lit" : ""}`}
          onClick={() => setTab("page")}
          title="Which page is being edited, and what it is called"
          aria-selected={tab === "page"}
        >
          <IconPage className="rc-key-icon" />
          <span className="rc-key-label">Page</span>
        </button>
      )}
      <div className="rc-tabs-tools">
        {BRUSH_KEYS.map(({ mode, label, title, Icon }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            className={`rc-key rc-key-tool${tab === mode ? " rc-key-lit" : ""}`}
            data-held={brushMode === mode && tab !== mode ? "" : undefined}
            onClick={() => holdTool(mode)}
            title={title}
            aria-selected={tab === mode}
          >
            <Icon className="rc-key-icon" />
            <span className="rc-key-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  /*
   * The TEXT tab: what a typed character is made of.
   *
   * No heading of its own — the lit key in the strip above is the heading, and
   * writing "Text style" under a key that already says TEXT is the panel telling
   * you where you are twice. What the section is called survives as its
   * `aria-label`, which is the one reader that cannot see the strip.
   *
   * Only ever shown with the text cursor up. A foreground, a background and a
   * double-height switch are settings for *typing* — the block brush paints its
   * six colours from its own motif and the pixel brush has a colour of its own —
   * so on a panel that shows one tool at a time this is the one tool's.
   */
  /*
   * The keyboard, moulded into the panel.
   *
   * A phone has a keyboard of its own and it is the wrong one: it slides up over
   * the page you are typing on, takes half the screen to do it, and offers
   * autocorrect and emoji to a grid of forty columns that can hold neither. So
   * the console brings its own — same caps, same travel, same lettering as every
   * other key on the panel — and the hidden input that collects real keystrokes
   * is told `inputMode="none"` on a phone so the system one never appears.
   *
   * `onMouseDown` is prevented on every cap, which is the whole trick that makes
   * this work alongside a real keyboard: without it, pressing a cap moves focus
   * off the grid and the next thing you typed on the physical keyboard went
   * nowhere. Nothing here needs focus — the caps write through
   * {@link typeCharacter} and {@link applyControlKey} directly — so the cheapest
   * correct answer is for focus never to move at all.
   */
  const holdGridFocus = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  const padCap = (
    label: string,
    onPress: () => void,
    { wide, lit, aria }: { wide?: string; lit?: boolean; aria?: string } = {},
  ) => (
    <button
      key={aria ?? label}
      type="button"
      className={`rc-key rc-key-char${lit ? " rc-key-lit" : ""}`}
      style={wide != null ? { flexGrow: Number(wide) } : undefined}
      onMouseDown={holdGridFocus}
      onClick={onPress}
      aria-label={aria ?? `Type ${label}`}
      aria-pressed={lit}
    >
      <span className="rc-pad-glyph">{label}</span>
    </button>
  );

  const textPad = (
    <div className="rc-keyboard" role="group" aria-label="Keyboard">
      {(padLayer === "symbols" ? PAD_SYMBOLS : PAD_LETTERS).map((row, rowIndex) => (
        <div className="rc-keyboard-row" key={rowIndex}>
          {rowIndex === 3 &&
            padLayer === "letters" &&
            padCap("⇧", () => setPadShift((v) => !v), {
              wide: "1.4",
              lit: padShift,
              aria: "Capitals",
            })}
          {[...row].map((ch, i) => {
            const glyph =
              padLayer === "letters" && padShift ? ch.toUpperCase() : ch;
            return padCap(glyph, () => typeCharacter(glyph), {
              aria: `Type ${glyph} (${rowIndex}-${i})`,
            });
          })}
          {rowIndex === 2 &&
            padCap("⌫", () => applyControlKey("Backspace"), {
              wide: "1.4",
              aria: "Backspace",
            })}
        </div>
      ))}
      <div className="rc-keyboard-row">
        {padCap(
          padLayer === "letters" ? "?!£" : "abc",
          () =>
            setPadLayer((l) => (l === "letters" ? "symbols" : "letters")),
          {
            wide: "1.6",
            aria:
              padLayer === "letters"
                ? "Show punctuation and accents"
                : "Show letters",
          },
        )}
        {padCap("", () => typeCharacter(" "), { wide: "4", aria: "Space" })}
        {padCap("◀", () => applyControlKey("ArrowLeft"), { aria: "Cursor left" })}
        {padCap("▶", () => applyControlKey("ArrowRight"), { aria: "Cursor right" })}
        {padCap("↵", () => applyControlKey("Enter"), {
          wide: "1.4",
          aria: "Start of next line",
        })}
      </div>
    </div>
  );

  const textStyleSection = (
    <section className="rc-cluster" aria-label="Text style">
      <div className="text-preview-three-col">
        <div className="text-preview-col">
          <span className="text-preview-label">Color</span>
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
          <span className="text-preview-label">Background</span>
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
        className={`rc-key rc-key-wide ${doubleHeightOn ? "rc-key-lit" : ""}`}
        onClick={() => setDoubleHeightOn((v) => !v)}
        aria-pressed={doubleHeightOn}
        title="Typed characters render at twice the row height. Not available on the last row."
      >
        <IconDoubleHeight className="rc-key-icon" />
        <span>Double height</span>
      </button>

      {textPad}

      {textStyles.history.length > 0 && (
        <div className="color-block brush-history">
          <span className="sidebar-field-label">Recent text styles</span>
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

  /*
   * What the tool on the open tab needs, and nothing else.
   *
   * One cluster rather than one per tool: only one tab is ever open, so four of
   * the five would always be empty panel. The tab it is describing is the one
   * the strip has open, not the one the pointer is holding — those are the same
   * thing except while the page panel is up, and the page panel replaces this
   * one outright.
   */
  const brushOptionsSection = (
    <section
      className="rc-cluster"
      aria-label={`${BRUSH_KEYS.find((k) => k.mode === brushMode)?.label ?? ""} options`}
    >
      {brushMode === "picker" && (
        <p className="sidebar-hint">
          Click any cell to copy what made it. A cell with a character hands its
          colours to the text tool and puts the cursor there; a mosaic cell hands
          its shape and its six colours to the block brush.
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
                  className="rc-key rc-key-wide"
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
                    <span className="preset-motif-name">{pattern.name}</span>
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
                    rightNeighbor !== null && slots[i] !== slots[rightNeighbor];
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
        </div>
      )}
      {brushMode === "blink" && (
        <p className="sidebar-hint">
          Click or drag to set blink on.
        </p>
      )}
      {/*
        * Remembered brushes live on the Block tab and nowhere else.
        *
        * The strip is a rack of mosaics — that is what a brush is here, a shape
        * and six colours — and a rack of them under the blink tool or the
        * eyedropper was a shelf of things those tools cannot use. Pixel brushes
        * still go into it as they are used, and picking one off it takes you to
        * the tool it belongs to (see `applyBrush`).
        */}
      {brushMode === "block" && brushes.history.length > 0 && (
        <div className="color-block brush-history">
          <span className="sidebar-field-label">Recent brushes</span>
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

  /*
   * The keys that do something to the whole page rather than to a cell.
   *
   * "Clear page" is the panel's red key — the one colour on it that means stop,
   * borrowed from the fastext strip for the one control here that cannot be
   * undone. It asks first, in place, rather than in a dialog over the picture.
   */
  const actionsSection = (
    <section className="rc-cluster rc-cluster-actions" aria-label="Whole page">
      {onBackToGrid != null && (
        <button
          type="button"
          className="rc-key rc-key-wide"
          onClick={() => {
            void onBackToGrid();
          }}
        >
          <IconBack className="rc-key-icon" />
          <span>Back to grid</span>
        </button>
      )}
      <button
        type="button"
        className="rc-key rc-key-wide"
        onClick={() => exportPageAsPng(page, "teletext.png", pageNumber ?? 100)}
      >
        <IconExport className="rc-key-icon" />
        <span>Export PNG</span>
      </button>
      {clearConfirmShown ? (
        <div className="clear-confirm">
          <span className="clear-confirm-label">Clear the whole page?</span>
          <div className="rc-keyrow">
            <button
              type="button"
              className="rc-key rc-key-wide rc-key-danger"
              onClick={() => {
                clearPage();
                setClearConfirmShown(false);
              }}
            >
              <span>Yes, clear</span>
            </button>
            <button
              type="button"
              className="rc-key rc-key-wide"
              onClick={() => setClearConfirmShown(false)}
            >
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="rc-key rc-key-wide rc-key-danger"
          onClick={() => setClearConfirmShown(true)}
        >
          <IconTrash className="rc-key-icon" />
          <span>Clear page</span>
        </button>
      )}
    </section>
  );

  /**
   * What is under the tab strip.
   *
   * The page panel, or the open tool's. Exactly one, always — a tab strip whose
   * tabs can be empty is a strip you learn to distrust.
   *
   * Exporting and clearing ride with the page, because that is what they are
   * about: they take the whole of it, not the cell the brush is over, and a red
   * key that wipes the page had no business sitting under the motif picker while
   * you were choosing a mosaic.
   */
  const tabPanel =
    tab === "page" ? (
      <>
        {pageControls}
        {actionsSection}
      </>
    ) : tab === "off" ? (
      textStyleSection
    ) : (
      brushOptionsSection
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
          /* Keeps the input focusable — and so still fed by a real keyboard —
             without the system's on-screen one sliding up over the page. The
             console's own keyboard is what types here instead; see `textPad`. */
          inputMode={isNarrow ? "none" : undefined}
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
      <div className="editor-layout editor-layout-narrow editor-console">
        {/* The page, with nothing competing for the screen. */}
        {grid}

        {/*
          * The handset.
          *
          * One body holding the whole panel, not a strip of brushes with the
          * rest hidden behind a button: a phone is taller than a teletext page
          * is, and the room left under the picture is enough for the controls
          * to simply be there. What used to be a sheet you pulled up over your
          * own work is now the lower half of the thing you are holding.
          *
          * The tab strip is its head and stays put while the rest scrolls —
          * choosing a tool is most of what editing is, and a tool you have to
          * scroll to is a tool you stop using.
          */}
        <div className="rc-handset">
          <div className="rc-handset-head">{tabs}</div>
          <div className="rc-handset-body">{tabPanel}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-layout editor-console">
      <aside className="rc-console">
        {brand}

        <section className="rc-cluster rc-cluster-tabs">{tabs}</section>

        {tabPanel}
      </aside>

      {grid}
    </div>
  );
}
