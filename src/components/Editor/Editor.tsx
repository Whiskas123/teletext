/**
 * The page editor: the strip along the top, the remote beside the page, and
 * the page itself.
 *
 * The controls are the television's own — moulded keys, an LED window,
 * engraved captions — because they work the same appliance the remote on
 * `/watch` does. What they are arranged into depends on the screen:
 *
 * - **On a desk** the strip across the top carries the document: the way out,
 *   which page and screen is open and what it is called, undo, export and
 *   clear. The remote stands down the left of the page and holds the five tool
 *   keys with everything about the tool in hand under them, always out — no
 *   drawers to open, nothing covering the picture.
 * - **On a phone** the strip shrinks to the LED and the keys a thumb needs
 *   most, the tool keys move to the foot of the screen where a thumb rests, and
 *   the tool's settings (and, for text, the panel's own keyboard) sit between
 *   the two. Everything else about the page — dialling it, its title, its
 *   subpages, export and clear — is one tap away in the page sheet.
 *
 * What a page *is* is the host's business: it hands the editor its page
 * controls as slots (see {@link EditorProps}) and the editor decides where they
 * go. Every edit leaves through `onEditCell`, via the undo history.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  textStyleKey,
  type TextStyle,
  type TextStyleHistoryState,
} from "../../domain/textStyle";
import {
  blockCell,
  blockText,
  boxPoints,
  copyRect,
  emptyCell,
  erasedCell,
  floodPoints,
  inRect,
  layoutText,
  lineEnd,
  linePoints,
  lineStart,
  moveRect,
  offsetRect,
  paintPoints,
  pasteBlock,
  rectFromCorners,
  rectIndexes,
  withSixelPart,
  wordJump,
  type CellBlock,
  type Point,
  type Rect,
  type Writes,
} from "../../domain/editOps";
import { normalizeCell } from "../../domain/pageOps";
import {
  IconBlink,
  IconBlock,
  IconBox,
  IconBucket,
  IconCopyPage,
  IconDoubleHeight,
  IconBrush,
  IconEraser,
  IconExport,
  IconGrid,
  IconLine,
  IconPage,
  IconPipette,
  IconPixel,
  IconRedo,
  IconSelect,
  IconTextCursor,
  IconTrash,
  IconUndo,
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
import { useCopy } from "../Room/useCopy";
import type { Copy } from "../../domain/copy";
import { TeletextGrid } from "../TeletextGrid/TeletextGrid";
import { ConfirmKey } from "./ConfirmKey";
import { CopyFromKey } from "./CopyFromKey";
import { loadEditorPrefs, saveEditorPrefs } from "./editorPrefs";
import { useEditHistory } from "./useEditHistory";

/**
 * Below this the editor is laid out for a phone. Exported so the host can make
 * the same call about its own controls (a tapped LED opens the page sheet on a
 * phone and takes typed digits on a desk).
 */
export const EDITOR_NARROW_QUERY = "(max-width: 900px)";

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

/**
 * What the pointer does on the page, as the grid's handler reads it.
 *
 * Derived from the three things a person actually chooses — which tool, which
 * size of brush when drawing, and whether the eyedropper is up — rather than
 * chosen directly. See `brushMode` in the component.
 */
type BrushMode = "off" | "block" | "pixel" | "blink" | "picker" | "select";

/**
 * What the editor is doing underneath: typing, drawing mosaics, setting blink,
 * or holding a selection. The toolbox (see {@link TOOLBOX}) is what a person
 * chooses from; each of its keys is one of these, with drawing's switches set.
 */
type Tool = "text" | "draw" | "blink" | "select";

/** Drawing freehand, or a shape put down in one drag (or, for a fill, one press). */
type DrawShape = "free" | "line" | "box" | "fill";

/** The editor's own clipboard format, beside the plain text everything reads. */
const CELLS_MIME = "application/x-teletext-cells";

/** A block of cells off the clipboard — which is anybody's to have written. */
function parseBlock(json: string): CellBlock | null {
  try {
    const raw = JSON.parse(json) as Partial<CellBlock> | null;
    const { width, height, cells } = raw ?? {};
    if (
      !Number.isInteger(width) || !Number.isInteger(height) ||
      width! < 1 || width! > COLS || height! < 1 || height! > ROWS ||
      !Array.isArray(cells) || cells.length !== width! * height!
    ) {
      return null;
    }
    return { width: width!, height: height!, cells: cells.map(normalizeCell) };
  } catch {
    return null;
  }
}

/** A rectangle of cells as a box over the grid, in fractions of it. */
function overlayBox(rect: Rect): React.CSSProperties {
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return {
    left: pct(rect.col, COLS),
    top: pct(rect.row, ROWS),
    width: pct(rect.width, COLS),
    height: pct(rect.height, ROWS),
  };
}

/** A key of the toolbox: one thing to do to the page, as in any paint program. */
type ToolId =
  | "select"
  | "text"
  | "picker"
  | "brush"
  | "eraser"
  | "fill"
  | "line"
  | "box"
  | "blink";

/**
 * The toolbox, in the order its keys are laid out (three to a row on a desk).
 *
 * It used to be four keys with switches nested inside them — Draw held paint
 * or erase, a size and a shape, and the eyedropper hid beside the colours —
 * which meant reading a panel to find the eraser. Now every tool is a key with
 * its picture on it, the way Paint and its descendants have taught everybody,
 * and the panel under the keys holds only that tool's settings.
 *
 * The words are looked up rather than written here: this table is the order
 * the keys are moulded in, which is not language.
 */
const TOOLBOX: readonly {
  id: ToolId;
  label: keyof Copy["editor"];
  title: keyof Copy["editor"];
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Alt and this letter takes the tool up; the letter alone, when not typing. */
  letter: string;
}[] = [
  { id: "select", label: "toolSelect", title: "toolSelectHint", Icon: IconSelect, letter: "S" },
  { id: "text", label: "toolText", title: "toolTextHint", Icon: IconTextCursor, letter: "T" },
  { id: "picker", label: "eyedropper", title: "eyedropperHint", Icon: IconPipette, letter: "I" },
  { id: "brush", label: "toolBrush", title: "toolBrushHint", Icon: IconBrush, letter: "B" },
  { id: "eraser", label: "toolEraser", title: "toolEraserHint", Icon: IconEraser, letter: "E" },
  { id: "fill", label: "shapeFill", title: "toolFillHint", Icon: IconBucket, letter: "F" },
  { id: "line", label: "shapeLine", title: "toolLineHint", Icon: IconLine, letter: "L" },
  { id: "box", label: "shapeBox", title: "toolBoxHint", Icon: IconBox, letter: "R" },
  { id: "blink", label: "toolBlink", title: "toolBlinkHint", Icon: IconBlink, letter: "P" },
];

/** Resolve one of {@link TOOLBOX}'s copy keys to the words themselves. */
function toolWord(copy: Copy, key: keyof Copy["editor"]): string {
  const value = copy.editor[key];
  return typeof value === "string" ? value : "";
}

/** How the undo shortcut is written on this machine, for the keys' tooltips. */
const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl+";

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

/**
 * What the host's page controls are handed, so they can behave for the shell
 * they are in: on a phone a tapped LED opens the page sheet, and a page dialled
 * on the sheet's keypad closes it again.
 */
export interface EditorPageSheet {
  narrow: boolean;
  open: () => void;
  close: () => void;
}

interface EditorProps {
  /** Page number used for the header row and the export. */
  pageNumber?: number;
  /**
   * Which screen of the page's carousel is being edited, and how many there
   * are — shown in the grid's header as `X/Y`, exactly as a viewer sees it.
   */
  subpage?: number;
  subpageCount?: number;
  /** The page to edit, supplied by the host (e.g. `useEditPage`'s normalized page). */
  page: TeletextPage;
  /**
   * Single-cell edit callback. Every edit (typing, painting, blink, backspace,
   * clear, undo) is applied through this callback as an absolute cell value at
   * `index`, so a collaborative store can persist and merge edits per cell.
   */
  onEditCell: (index: number, cell: Cell) => void;
  /** Controlled cursor index; the editor keeps its own when omitted. */
  cursorIndex?: number;
  /** Notified whenever the local cursor position changes (e.g. to publish presence). */
  onCursorChange?: (index: number | null) => void;
  /** Other members' editing cursors to render on the grid, attributed by color. */
  remoteCursors?: EditorRemoteCursor[];

  /* ── the host's page controls, placed by the editor ─────────────────────── */

  /** The way out and the save lamp: the near end of the strip. */
  nameplate?: ReactNode;
  /** The LED window and the page rockers: always on the strip. */
  pageDisplay?: (sheet: EditorPageSheet) => ReactNode;
  /** The keypad that dials a page: in the page sheet, on a phone only. */
  pageKeypad?: (sheet: EditorPageSheet) => ReactNode;
  /** The page's title and subpages: on the strip on a desk, in the sheet on a phone. */
  pageDetails?: ReactNode;
  /** Something that went wrong with the page as a whole, said under the strip. */
  alert?: ReactNode;
  /** Who is editing this screen: at the foot of the remote on a desk, in the page sheet on a phone. */
  people?: ReactNode;
  /**
   * Another page's content, for copying onto this one; null when there is
   * nothing there. The copy-from key is only on the panel when this is given.
   */
  readPage?: (pageNumber: number, subpage: number) => TeletextPage | null;
}

export function Editor({
  pageNumber,
  subpage = 1,
  subpageCount = 1,
  page,
  onEditCell,
  cursorIndex: controlledCursorIndex,
  onCursorChange,
  remoteCursors,
  nameplate,
  pageDisplay,
  pageKeypad,
  pageDetails,
  alert,
  people,
  readPage,
}: EditorProps) {
  const copy = useCopy();
  const isNarrow = useMediaQuery(EDITOR_NARROW_QUERY);

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

  /*
   * Every write goes through the history, which passes it on to the host.
   * See `useEditHistory` for how writes are gathered into undoable steps.
   */
  const history = useEditHistory(page, onEditCell, `${pageNumber}/${subpage}`);
  const writeCell = history.write;
  const { transact, undo, redo } = history;

  // Whole-page clear: an empty cell at every position, as one undoable step.
  const clearPage = useCallback(() => {
    transact(() => {
      for (let i = 0; i < TOTAL_CELLS; i++) writeCell(i, emptyCell());
    });
  }, [transact, writeCell]);

  const [fg, setFg] = useState<TeletextColor>("white");
  const [bg, setBg] = useState<TeletextColor>("black");
  /** When on, typed characters render at double the row height (text only — not the block/pixel brushes). */
  const [doubleHeightOn, setDoubleHeightOn] = useState(false);
  const [tool, setTool] = useState<Tool>("text");
  const [drawShape, setDrawShape] = useState<DrawShape>("free");
  /** The rectangle the select tool holds, and where a drag would put it. */
  const [selection, setSelection] = useState<Rect | null>(null);
  const [ghost, setGhost] = useState<Rect | null>(null);
  /** The last block copied here: what the panel's Paste key puts down. */
  const [clip, setClip] = useState<CellBlock | null>(null);
  /** Read once: what this browser remembered from last time. */
  const [prefs] = useState(loadEditorPrefs);
  const [showGrid, setShowGrid] = useState(prefs.showGrid);
  /** The page at twice the size, on a phone, where a sixth of a cell is 2px. */
  const [zoomed, setZoomed] = useState(false);
  /** Drawing a whole cell at a time, or one sixth of one. */
  const [drawSize, setDrawSize] = useState<"cell" | "pixel">("cell");
  /** The eyedropper is up: the next cell pressed gives its colours. */
  const [picking, setPicking] = useState(false);
  const brushMode: BrushMode = picking
    ? "picker"
    : tool === "text"
      ? "off"
      : tool === "blink"
        ? "blink"
        : tool === "select"
          ? "select"
          : drawSize === "cell"
          ? "block"
          : "pixel";
  /**
   * Whether the pixel and blink tools take away rather than put down.
   *
   * Alt did this on its own before, which left a phone — no Alt key — able to
   * paint and never to erase. Alt still works on a desk, as a momentary switch.
   */
  const [eraseOn, setEraseOn] = useState(false);
  /** Which of the text colours the phone's one-line bar is choosing, if either. */
  const [textPick, setTextPick] = useState<"fg" | "bg" | null>(null);
  /** Whether the page sheet is up (phone only). */
  const [sheetOpen, setSheetOpen] = useState(false);
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
  /** Recently used brushes (index 0 = most recent) and the stepper cursor. */
  const [brushes, setBrushes] = useState<BrushHistoryState>(() => ({
    history: prefs.brushes,
    index: 0,
  }));
  /** Recently used text styles, the typing counterpart of the brush strip. */
  const [textStyles, setTextStyles] = useState<TextStyleHistoryState>(() => ({
    history: prefs.textStyles,
    index: 0,
  }));
  useEffect(() => {
    saveEditorPrefs({ brushes: brushes.history, textStyles: textStyles.history, showGrid });
  }, [brushes.history, textStyles.history, showGrid]);
  // A selection is a place on one screen; it does not follow to the next.
  useEffect(() => {
    setSelection(null);
    setGhost(null);
  }, [pageNumber, subpage]);
  /** Sixel sub-cell (0-5) the pixel brush is currently aimed at. */
  const [hoveredPartIndex, setHoveredPartIndex] = useState<number | null>(null);
  /** Which sixth of the motif preview the palette under it is colouring. */
  const [selectedSixelIndex, setSelectedSixelIndex] = useState(0);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);
  const isDrawingRef = useRef(false);
  /**
   * The last cell this stroke painted, so the gap to the next one can be filled.
   *
   * A drag is sampled, not continuous: a hand moving quickly crosses several
   * cells between two pointer reports, and painting only the reported cells
   * drew a dashed line. See `domain/strokeLine.ts`.
   */
  const lastPaintedRef = useRef<number | null>(null);
  /** Where the brush last touched: a shift-press draws a straight line from it. */
  const lastPointRef = useRef<Point | null>(null);
  /**
   * The shape being dragged out: the page as it was when the drag began, where
   * it began, and the cells the shape covered at the last sample — which are
   * put back before it is drawn again to where the pointer now is.
   */
  const shapeRef = useRef<{
    base: TeletextPage;
    from: Point;
    box: boolean;
    erase: boolean;
    shown: Set<number>;
  } | null>(null);
  /** A drag of the select tool: marking out a new rectangle, or moving the one held. */
  const selectDragRef = useRef<{ move: boolean; start: number; last: number; copy: boolean } | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  /** Remember a brush that was just painted with (see `domain/brush.ts`). */
  const rememberBrush = useCallback((brush: Brush) => {
    setBrushes((prev) => recordBrush(prev, brush));
  }, []);

  /** Remember a text style that was just typed with (see `domain/textStyle.ts`). */
  const rememberTextStyle = useCallback((style: TextStyle) => {
    if (!isRecordableTextStyle(style)) return;
    setTextStyles((prev) => recordTextStyle(prev, style));
  }, []);

  /**
   * Take up a tool.
   *
   * The eraser is put down with the tool it belonged to: picking up the pixel
   * brush later and finding it silently rubbing out is the kind of surprise
   * that makes people stop trusting a switch.
   */
  const selectTool = useCallback(
    (next: Tool) => {
      if (next !== tool) setEraseOn(false);
      // Select starts on the cell the cursor was in, and Write takes the
      // cursor to where the selection was: the two tools point at one place.
      if (next === "select" && tool !== "select") {
        setSelection((held) => held ?? rectFromCorners(cursorIndex, cursorIndex));
      }
      if (next === "text" && tool === "select" && selection != null) {
        setCursorIndex(indexAt(selection.col, selection.row));
      }
      setTool(next);
      setPicking(false);
    },
    [tool, cursorIndex, selection, setCursorIndex],
  );

  /**
   * Take up whatever made a brush or a style — a remembered one, or one the
   * eyedropper just lifted: text is the text tool, a mosaic is Draw at the
   * size it was painted at.
   */
  const holdTool = useCallback(
    (mode: "off" | "block" | "pixel") => {
      selectTool(mode === "off" ? "text" : "draw");
      if (mode !== "off") setDrawSize(mode === "block" ? "cell" : "pixel");
    },
    [selectTool],
  );

  const applyTextStyle = useCallback(
    (style: TextStyle) => {
      setFg(style.fg);
      setBg(style.bg);
      setDoubleHeightOn(style.doubleHeight);
      holdTool("off");
    },
    [holdTool],
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
      writeCell(index, blockCell(page[index], blockPattern, brushColors));
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
   * Paint (or erase) a single sixth of a cell, leaving the other five alone
   * (see `withSixelPart`).
   */
  const paintSixelPart = useCallback(
    (index: number, part: number, erase: boolean) => {
      const cell = page[index];
      // Dragging fires many events over the same sixth; a write that would not
      // change the cell is skipped so the collaborative store isn't spammed.
      const next = withSixelPart(cell, part, pixelColor, erase);
      if (next !== cell) writeCell(index, next);
      setCursorIndex(index);
      if (!erase) rememberBrush({ kind: "pixel", color: pixelColor });
    },
    [page, writeCell, pixelColor, setCursorIndex, rememberBrush],
  );

  /** The block brush's eraser: the cell goes back to an empty one. */
  const eraseCell = useCallback(
    (index: number) => {
      const next = erasedCell(page[index]);
      if (next !== page[index]) writeCell(index, next);
      setCursorIndex(index);
    },
    [page, writeCell, setCursorIndex],
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
    setSelectedSixelIndex(0);
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
  const beginStroke = useCallback(
    (index: number, paint: (cellIndex: number) => void) => {
      // The whole stroke, however long, is one step of undo.
      history.begin();
      isDrawingRef.current = true;
      lastPaintedRef.current = index;
      paint(index);
    },
    [history],
  );

  const writeAll = useCallback(
    (writes: Writes) => {
      for (const [index, cell] of writes) writeCell(index, cell);
    },
    [writeCell],
  );

  /** What the brush in hand does to one cell: the same for a stroke and a shape. */
  const brushPaint = useCallback(
    (erase: boolean) =>
      (cell: Cell, part: number): Cell =>
        drawSize === "pixel"
          ? withSixelPart(cell, part, pixelColor, erase)
          : erase
            ? erasedCell(cell)
            : blockCell(cell, blockPattern, brushColors),
    [drawSize, pixelColor, blockPattern, brushColors],
  );

  const rememberBrushInHand = useCallback(() => {
    rememberBrush(
      drawSize === "pixel"
        ? { kind: "pixel", color: pixelColor }
        : {
            kind: "block",
            motifIndex: selectedMotifIndex,
            colors: [...brushColors] as SixelColors,
            pattern: blockPattern,
          },
    );
  }, [rememberBrush, drawSize, pixelColor, selectedMotifIndex, brushColors, blockPattern]);

  /**
   * Draw the shape being dragged out as far as `to`.
   *
   * Always from the page as it was when the drag began: the cells the last
   * sample's shape covered go back to what they were, then this one's are
   * painted. It is all one open step of history, so the cells put back net out
   * to nothing and undo takes the finished shape away whole.
   */
  const drawShapeTo = useCallback(
    (to: Point) => {
      const shape = shapeRef.current;
      if (shape == null) return;
      const pixel = drawSize === "pixel";
      const points = (shape.box ? boxPoints : linePoints)(shape.from, to, pixel);
      const writes = paintPoints(shape.base, points, brushPaint(shape.erase));
      for (const index of shape.shown) {
        if (!writes.has(index)) writeCell(index, shape.base[index]);
      }
      writeAll(writes);
      shape.shown = new Set(writes.keys());
    },
    [drawSize, brushPaint, writeCell, writeAll],
  );

  /* ── the selection ──────────────────────────────────────────────────────── */

  /** Move (or copy) what is selected by a number of cells, as one step. */
  const moveSelection = useCallback(
    (dCol: number, dRow: number, copy: boolean) => {
      if (selection == null) return;
      const to = offsetRect(selection, dCol, dRow);
      if (to.col === selection.col && to.row === selection.row) return;
      transact(() => writeAll(moveRect(page, selection, to, copy)));
      setSelection(to);
    },
    [selection, page, transact, writeAll],
  );

  /** Give every selected cell a new value, as one step. */
  const editSelection = useCallback(
    (edit: (cell: Cell) => Cell) => {
      if (selection == null) return;
      transact(() => {
        for (const index of rectIndexes(selection)) writeCell(index, edit(page[index]));
      });
    },
    [selection, page, transact, writeCell],
  );

  const deleteSelection = useCallback(() => editSelection(emptyCell), [editSelection]);

  const copySelection = useCallback((): CellBlock | null => {
    if (selection == null) return null;
    const block = copyRect(page, selection);
    setClip(block);
    return block;
  }, [selection, page]);

  /** Where a paste lands: the selection's corner when selecting, else the cursor. */
  const pasteAnchor =
    tool === "select" && selection != null
      ? indexAt(selection.col, selection.row)
      : cursorIndex;

  /** Put a copied block down, and hold it selected so it can be moved into place. */
  const pasteCells = useCallback(
    (block: CellBlock) => {
      const { writes, rect } = pasteBlock(block, pasteAnchor);
      transact(() => writeAll(writes));
      setSelection(rect);
      selectTool("select");
    },
    [pasteAnchor, transact, writeAll, selectTool],
  );

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
      // Alt is a momentary eraser on a desk; the switch is the lasting one.
      const erase = alt || eraseOn;
      const drawing = isDrawingRef.current;

      if (brushMode === 'picker') {
        setHoveredCellIndex(index);
        // Nothing to drag: picking is a single act, on the way down.
        if (phase === 'down') pickFromCell(index);
        return;
      }

      if (brushMode === 'select') {
        if (phase === 'down') {
          // Pressing on what is held picks it up; anywhere else starts again.
          const move = selection != null && inRect(selection, index);
          selectDragRef.current = { move, start: index, last: index, copy: alt };
          if (!move) setSelection(rectFromCorners(index, index));
          return;
        }
        const drag = selectDragRef.current;
        if (drag == null) return;
        drag.last = index;
        if (!drag.move) {
          setSelection(rectFromCorners(drag.start, index));
        } else if (selection != null) {
          const from = rowColFromIndex(drag.start);
          const to = rowColFromIndex(index);
          setGhost(offsetRect(selection, to.col - from.col, to.row - from.row));
        }
        return;
      }

      /*
       * Shapes. A fill is one press. A line or a box is dragged out from where
       * the pointer went down — and a shift-press with the freehand brush draws
       * a straight line from where the last stroke ended, as everywhere else.
       */
      if (brushMode === 'block' || brushMode === 'pixel') {
        const point = { index, part };
        if (phase === 'down' && drawShape === 'fill') {
          const pixel = brushMode === 'pixel';
          transact(() =>
            writeAll(paintPoints(page, floodPoints(page, point, pixel), brushPaint(erase))),
          );
          if (!erase) rememberBrushInHand();
          return;
        }
        const from =
          drawShape !== 'free' ? point : e.shiftKey ? lastPointRef.current : null;
        if (phase === 'down' && from != null) {
          history.begin();
          isDrawingRef.current = true;
          shapeRef.current = {
            base: page,
            from,
            box: drawShape === 'box',
            erase,
            shown: new Set(),
          };
        }
        if (drawing || phase === 'down') lastPointRef.current = point;
        if (shapeRef.current != null) {
          setHoveredCellIndex(index);
          setHoveredPartIndex(brushMode === 'pixel' ? part : null);
          drawShapeTo(point);
          return;
        }
      }

      if (brushMode === 'block') {
        setHoveredCellIndex(index);
        const paint = erase ? eraseCell : paintCell;
        if (phase === 'down') {
          beginStroke(index, paint);
        } else if (drawing) {
          paintAlong(index, paint);
        }
        return;
      }

      if (brushMode === 'pixel') {
        setHoveredCellIndex(index);
        setHoveredPartIndex(part);
        if (phase === 'down') {
          beginStroke(index, (cell) => paintSixelPart(cell, part, erase));
        } else if (drawing) {
          paintAlong(index, (cell) => paintSixelPart(cell, part, erase));
        }
        return;
      }

      if (brushMode === 'blink') {
        const on = !erase;
        if (phase === 'down') {
          beginStroke(index, (cell) => paintBlinkCell(cell, on));
        } else if (drawing) {
          paintAlong(index, (cell) => paintBlinkCell(cell, on));
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
      eraseOn,
      beginStroke,
      paintAlong,
      paintCell,
      paintBlinkCell,
      paintSixelPart,
      eraseCell,
      pickFromCell,
      focusHiddenInput,
      setCursorIndex,
      selection,
      drawShape,
      page,
      history,
      transact,
      writeAll,
      brushPaint,
      rememberBrushInHand,
      drawShapeTo,
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
    if (shapeRef.current != null && !shapeRef.current.erase) rememberBrushInHand();
    shapeRef.current = null;
    history.commit();
    // A selection that was being carried is put down where it was let go.
    const drag = selectDragRef.current;
    selectDragRef.current = null;
    setGhost(null);
    if (drag?.move) {
      const from = rowColFromIndex(drag.start);
      const to = rowColFromIndex(drag.last);
      moveSelection(to.col - from.col, to.row - from.row, drag.copy);
    }
  }, [history, rememberBrushInHand, moveSelection]);

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
      history.commit();
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [history]);

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
        writeCell(index + COLS, emptyCell());
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
      let wasDoubleHeight = false;
      // One character is one step, even when it also clears the row under a
      // double-height glyph.
      transact(() => {
        wasDoubleHeight = setCellChar(cursorIndex, char);
      });
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
    [cursorIndex, setCellChar, page, setCursorIndex, transact],
  );

  /** Type a whole text at once, from where a paste lands, as one step. */
  const pasteText = useCallback(
    (text: string) => {
      const placed = layoutText(text, pasteAnchor, doubleHeightOn ? 2 : 1);
      if (placed.length === 0) return;
      transact(() => {
        for (const { index, char } of placed) setCellChar(index, char);
      });
      if (tool === "text") {
        setCursorIndex(Math.min(TOTAL_CELLS - 1, placed[placed.length - 1].index + 1));
      }
    },
    [pasteAnchor, doubleHeightOn, transact, setCellChar, tool, setCursorIndex],
  );

  /*
   * The clipboard. The grid's input is what holds focus, so copy, cut and
   * paste arrive there. A copied selection goes out twice: as plain text for
   * anything else, and as cells for this editor, in this or another tab.
   */
  const handleCopy = useCallback(
    (e: React.ClipboardEvent, cut: boolean) => {
      if (tool !== "select") return;
      const block = copySelection();
      if (block == null) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", blockText(block));
      e.clipboardData.setData(CELLS_MIME, JSON.stringify(block));
      if (cut) deleteSelection();
    },
    [tool, copySelection, deleteSelection],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const block =
        parseBlock(e.clipboardData.getData(CELLS_MIME)) ??
        // A browser that would not carry the cells still carried their text.
        (clip != null && text === blockText(clip) ? clip : null);
      if (block != null) pasteCells(block);
      else if (tool === "text" || tool === "select") pasteText(text);
    },
    [clip, pasteCells, pasteText, tool],
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
          transact(() => setCellChar(cursorIndex, " "));
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
        case "Home":
          setCursorIndex(resolveDoubleHeightCursor(page, lineStart(cursorIndex), 1));
          return true;
        case "End":
          setCursorIndex(resolveDoubleHeightCursor(page, lineEnd(page, cursorIndex), 1));
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
    [cursorIndex, page, setCellChar, setCursorIndex, writeCell, transact],
  );

  /** Which key of the toolbox is down, read off what the editor is doing. */
  const activeTool: ToolId = picking
    ? "picker"
    : tool !== "draw"
      ? tool
      : drawShape !== "free"
        ? drawShape
        : eraseOn
          ? "eraser"
          : "brush";

  const toolInHand = TOOLBOX.find((key) => key.id === activeTool) ?? TOOLBOX[0];

  /** Take up a key of the toolbox. */
  const pickTool = useCallback(
    (id: ToolId) => {
      if (id === "picker") return setPicking(true);
      if (id === "select" || id === "text" || id === "blink") return selectTool(id);
      selectTool("draw");
      setDrawShape(id === "brush" || id === "eraser" ? "free" : id);
      setEraseOn(id === "eraser");
    },
    [selectTool],
  );

  /**
   * A key pressed while not typing: a tool's letter, the grid, or Escape.
   * Letters are free for this whenever they are not page content.
   */
  const pressShortcut = useCallback(
    (key: string) => {
      const letter = key.toUpperCase();
      const picked = TOOLBOX.find((k) => k.letter === letter);
      if (picked != null) return pickTool(picked.id);
      if (letter === "G") return setShowGrid((on) => !on);
      // Escape puts down whatever is held: the eyedropper (which has its own
      // listener), then the selection, then the tool.
      if (key === "Escape" && !picking) {
        if (tool === "select" && selection != null) return setSelection(null);
        selectTool("text");
      }
    },
    [pickTool, selectTool, picking, tool, selection],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod || e.altKey) {
        // Copy, cut, paste and select-all are the browser's, and reach the
        // clipboard handlers on the input.
        if (mod && ["c", "x", "v", "a"].includes(e.key.toLowerCase())) return;
        e.preventDefault();
        // Alt and a letter works even while typing, when the letter alone is
        // page content. `code`, because Alt changes what the key produces.
        if (e.altKey && !mod && e.code.startsWith("Key")) {
          pressShortcut(e.code.slice(3));
          return;
        }
        if (tool === "text" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          const dir = e.key === "ArrowLeft" ? -1 : 1;
          // ⌘ and an arrow is Home and End on a Mac; Ctrl or Alt and an arrow
          // goes a word at a time everywhere.
          const target = e.metaKey
            ? dir === -1
              ? lineStart(cursorIndex)
              : lineEnd(page, cursorIndex)
            : wordJump(page, cursorIndex, dir);
          setCursorIndex(resolveDoubleHeightCursor(page, target, dir));
        }
        return;
      }
      if (tool === "select") {
        e.preventDefault();
        const nudge = (
          { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
            string,
            [number, number] | undefined
          >
        )[e.key];
        if (nudge != null) moveSelection(nudge[0], nudge[1], false);
        else if (e.key === "Backspace" || e.key === "Delete") deleteSelection();
        else pressShortcut(e.key);
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
            pressShortcut(e.key);
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
      tool,
      pressShortcut,
      moveSelection,
      deleteSelection,
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
    <div className="rc-keyboard" role="group" aria-label={copy.editor.keyboard}>
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
        {/* U+FE0E keeps iOS from drawing these as emoji */}
        {padCap("◀\uFE0E", () => applyControlKey("ArrowLeft"), { aria: "Cursor left" })}
        {padCap("▶\uFE0E", () => applyControlKey("ArrowRight"), { aria: "Cursor right" })}
        {padCap("↵", () => applyControlKey("Enter"), {
          wide: "1.4",
          aria: "Start of next line",
        })}
      </div>
    </div>
  );

  /*
   * The two racks, as their caps alone.
   *
   * A remembered style or brush is one swatch and a click, and the strip of them
   * is wanted in two places that frame it differently: labelled inside a panel on
   * the handset, bare and elastic along the toolbar. So what is written once is
   * the caps — the frame is whatever is holding them.
   */
  const textStyleChips = textStyles.history.map((style, idx) => (
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
  ));

  const brushChips = brushes.history.map((brush, idx) => (
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
  ));

  /*
   * Undo and redo from the keyboard, wherever focus is.
   *
   * On the grid's own input, and on any key of the panel — which never take
   * focus, so that is mostly the grid anyway. A text field keeps its own undo:
   * ⌘Z in the title box should take back the last letter of the title, not the
   * last stroke on the page.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== hiddenInputRef.current &&
        target?.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  /* ── the page sheet (phone) ─────────────────────────────────────────────── */

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  // Turning a tablet on its side can cross the breakpoint with the sheet up;
  // on a desk there is no sheet to be up.
  const sheetShown = sheetOpen && isNarrow;
  const sheet: EditorPageSheet = { narrow: isNarrow, open: openSheet, close: closeSheet };

  useEffect(() => {
    if (!sheetShown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetShown, closeSheet]);

  /**
   * The panel does not take the page's focus away from it.
   *
   * Focus belongs to the grid — it is where typed characters land — and a
   * panel that stole it every time you chose a colour would be a panel you had
   * to click your way back out of. Preventing the default on `mousedown` is the
   * whole of it: the key never becomes the focused element and the next thing
   * typed still lands on the page. The exceptions are the controls that are
   * *about* focus: a text field, and the LED window, which takes typed digits.
   */
  const keepGridFocus = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable], .rc-display"))
      return;
    event.preventDefault();
  }, []);

  /* ── the tool keys, and what each tool needs ────────────────────────────── */

  /*
   * The keys carry a picture and nothing else; what each one is called is
   * engraved on the panel under it, as on the set's own remote. The one in
   * use sits pressed into the panel with its lamp lit.
   */
  const toolKeys = (
    <div className="rc-tools" role="radiogroup" aria-label={copy.editor.tools}>
      {TOOLBOX.map(({ id, label, title, Icon, letter }) => (
        <div className="rc-keycap" key={id}>
          <button
            type="button"
            role="radio"
            aria-checked={activeTool === id}
            aria-label={toolWord(copy, label)}
            className={`rc-key rc-key-tool${activeTool === id ? " rc-key-lit" : ""}`}
            onClick={() => pickTool(id)}
            title={`${toolWord(copy, title)} (Alt+${letter})`}
          >
            <Icon className="rc-key-icon" />
          </button>
          <span className="rc-cap" aria-hidden>
            {toolWord(copy, label)}
          </span>
        </div>
      ))}
    </div>
  );

  // The eyedropper is put down with Escape, like anything else held up.
  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [picking]);

  /** The eight teletext colours as a row of caps, one of them down. */
  const palette = (
    value: TeletextColor | null,
    onPick: (color: TeletextColor) => void,
    describe: (color: TeletextColor) => string,
  ) => (
    <div className="rc-palette">
      {TELETEXT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch teletext-bg-${color}${value === color ? " active" : ""}`}
          onClick={() => onPick(color)}
          title={describe(color)}
          aria-label={describe(color)}
          aria-pressed={value === color}
        />
      ))}
    </div>
  );

  /** A cluster's engraved heading, with room for a key at the far end. */
  const clusterHead = (label: string, end?: ReactNode) => (
    <div className="rc-cluster-head">
      <span className="rc-legend">{label}</span>
      {end}
    </div>
  );

  /** Remembered styles or brushes, when there are any to remember. */
  const recentCluster = (chips: ReactNode[], label: string) =>
    chips.length > 0 ? (
      <section className="rc-cluster rc-cluster-recent">
        {clusterHead(copy.editor.recent)}
        <div className="brush-history-strip" role="group" aria-label={label}>
          {chips}
        </div>
      </section>
    ) : null;

  /** Two or three keys of which exactly one is down. */
  const segmented = <T extends string>(
    label: string,
    value: T,
    options: readonly { value: T; label: string; icon?: ReactNode }[],
    onPick: (value: T) => void,
  ) => (
    <div className="rc-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`rc-key${value === option.value ? " rc-key-lit" : ""}`}
          onClick={() => onPick(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );

  /*
   * WRITE: what a typed character is made of.
   *
   * A foreground, a background and a double-height switch are settings for
   * typing — the mosaic brush has colours of its own — so they belong to the
   * one tool.
   */
  const textOptions = (
    <>
      <section className="rc-cluster">
        {/* On a phone the keyboard needs the height a heading would take. */}
        {!isNarrow && clusterHead(copy.editor.colours)}
        <div className="rc-swatch-row">
          <span className="rc-sublegend">{copy.editor.color}</span>
          {palette(fg, setFg, (c) => `${copy.editor.color}: ${c}`)}
        </div>
        <div className="rc-swatch-row">
          <span className="rc-sublegend">{copy.editor.background}</span>
          {palette(bg, setBg, (c) => `${copy.editor.background}: ${c}`)}
        </div>
      </section>
      <section className="rc-cluster">
        <div className="rc-text-style">
          <button
            type="button"
            className={`rc-key rc-key-toggle${doubleHeightOn ? " rc-key-lit" : ""}`}
            onClick={() => setDoubleHeightOn((v) => !v)}
            aria-pressed={doubleHeightOn}
            title={copy.editor.doubleHeightHint}
          >
            <IconDoubleHeight className="rc-key-icon" />
            <span>{copy.editor.doubleHeight}</span>
          </button>
          <div
            className={`text-preview-cell teletext-fg-${fg} teletext-bg-${bg}${
              doubleHeightOn ? " text-preview-cell-double-height" : ""
            }`}
            aria-hidden
          />
        </div>
      </section>
      {recentCluster(textStyleChips, copy.editor.recentTextStyles)}
    </>
  );

  /*
   * DRAW: a brush size, an eraser, and what the brush is loaded with.
   *
   * Cell and pixel were two tools; they are one brush at two sizes, and a
   * size is a switch. The motif only means anything for a whole cell, so it
   * is only there then.
   */
  const selectedSlot = selectedMotif.slots[selectedSixelIndex];
  const multiSlot = motifSlotCount(selectedMotif.slots) > 1;
  /** Choosing a colour is choosing to paint, so it puts the eraser down. */
  const paintWith = (fn: () => void) => () => {
    fn();
    setEraseOn(false);
  };

  const motifCluster = (
    <section className="rc-cluster">
      {clusterHead(copy.editor.motif)}
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
              onClick={paintWith(() => selectMotif(idx))}
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
            </button>
          );
        })}
      </div>
    </section>
  );

  const cellColours = (
    <>
      <div className="rc-motif-colours">
        <div
          className="brush-sixel-preview"
          role="radiogroup"
          aria-label={copy.editor.colours}
        >
          {([0, 1, 2, 3, 4, 5] as const).map((i) => {
            const slots = selectedMotif.slots;
            const slotIndex = slots[i];
            /* Grid is 2×3 row-major: [0][1] / [2][3] / [4][5]. */
            const rightNeighbor = i % 2 === 0 ? i + 1 : null;
            const bottomNeighbor = i <= 3 ? i + 2 : null;
            const borderRight =
              rightNeighbor !== null && slots[i] !== slots[rightNeighbor];
            const borderBottom =
              bottomNeighbor !== null && slots[i] !== slots[bottomNeighbor];
            const chosen = multiSlot && slotIndex === selectedSlot;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={slotIndex === selectedSlot}
                className={`brush-sixel-part teletext-bg-${brushColors[i]}${
                  borderRight ? " brush-sixel-part-border-r" : ""
                }${borderBottom ? " brush-sixel-part-border-b" : ""}${
                  hoveredSlotIndex === slotIndex ? " brush-sixel-part-hover" : ""
                }${chosen ? " brush-sixel-part-active" : ""}`}
                onMouseEnter={() => setHoveredSlotIndex(slotIndex)}
                onMouseLeave={() => setHoveredSlotIndex(null)}
                onClick={() => setSelectedSixelIndex(i)}
                aria-label={`${i + 1}: ${brushColors[i]}`}
              />
            );
          })}
        </div>
        <div className="rc-motif-palette">
          {palette(
            brushColors[selectedSixelIndex],
            (color) => paintWith(() => setMotifSlotColor(selectedSlot, color))(),
            (c) => `${copy.editor.colours}: ${c}`,
          )}
        </div>
      </div>

      {/*
        * A lifted shape is otherwise invisible state: the motif previews all
        * show full cells, so a half-filled brush would look identical to a
        * solid one right up until it painted.
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
            <span className="rc-sublegend">{copy.editor.pickedShape}</span>
            <button
              type="button"
              className="rc-key rc-key-wide"
              onClick={() => setBlockPattern(SIXEL_MAX)}
            >
              <span>{copy.editor.fillWholeCell}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );

  const drawOptions = (
    <>
      <section className="rc-cluster">
        {clusterHead(copy.editor.size)}
        {segmented(
          copy.editor.size,
          drawSize,
          [
            { value: "cell", label: copy.editor.sizeCell, icon: <IconBlock className="rc-key-icon" /> },
            { value: "pixel", label: copy.editor.sizePixel, icon: <IconPixel className="rc-key-icon" /> },
          ] as const,
          (size) => {
            setDrawSize(size);
            setPicking(false);
          },
        )}
      </section>

      {/* What the brush is loaded with — which an eraser is not. */}
      {!eraseOn && (
        <>
          {drawSize === "cell" && motifCluster}

          <section className="rc-cluster">
            {clusterHead(copy.editor.colours)}
            {drawSize === "cell"
              ? cellColours
              : palette(
                  pixelColor,
                  (color) => paintWith(() => setPixelColor(color))(),
                  (c) => `${copy.editor.colours}: ${c}`,
                )}
          </section>

          {recentCluster(brushChips, copy.editor.recentBrushes)}
        </>
      )}
    </>
  );

  /* BLINK: on or off, over whatever is already on the page. */
  const blinkOptions = (
    <section className="rc-cluster">
      {segmented(
        copy.editor.toolBlink,
        eraseOn ? "off" : "on",
        [
          { value: "on", label: copy.editor.blinkOn, icon: <IconBlink className="rc-key-icon" /> },
          { value: "off", label: copy.editor.blinkOff, icon: <IconEraser className="rc-key-icon" /> },
        ] as const,
        (value) => setEraseOn(value === "off"),
      )}
      {/* A blank cell set to blink shows nothing at all, so the page marks
          them while this tool is up (see `.show-blink-marks`). */}
      <p className="rc-hint">{copy.editor.blinkMarks}</p>
    </section>
  );

  /*
   * SELECT: a rectangle of the page, and what can be done to all of it.
   *
   * The clipboard keys are here as well as on the keyboard because a phone has
   * no ⌘C.
   */
  const selectionKey = (label: string, onPress: () => void, enabled = selection != null) => (
    <button type="button" className="rc-key" onClick={onPress} disabled={!enabled}>
      <span>{label}</span>
    </button>
  );
  const selectOptions = (
    <>
      <section className="rc-cluster">
        {!isNarrow && <p className="rc-hint">{copy.editor.selectHint}</p>}
        <div className="rc-segmented rc-segmented-wrap">
          {selectionKey(copy.editor.copy, copySelection)}
          {selectionKey(copy.editor.cut, () => {
            copySelection();
            deleteSelection();
          })}
          {selectionKey(copy.editor.paste, () => clip != null && pasteCells(clip), clip != null)}
          {selectionKey(copy.editor.deleteSelection, deleteSelection)}
        </div>
      </section>
    </>
  );

  const toolOptions = picking ? (
    // The eyedropper has nothing to set: it says what the next press will do.
    <section className="rc-cluster">
      <p className="rc-hint">{copy.editor.eyedropperHint}</p>
    </section>
  ) : tool === "text" ? (
    textOptions
  ) : tool === "draw" ? (
    drawOptions
  ) : tool === "blink" ? (
    blinkOptions
  ) : (
    selectOptions
  );

  /* ── the keys that act on the whole page ────────────────────────────────── */

  /** A strip key: a picture on the cap, its name engraved under it. */
  const capped = (key: ReactNode, caption: string) => (
    <div className="rc-keycap">
      {key}
      <span className="rc-cap" aria-hidden>
        {caption}
      </span>
    </div>
  );

  const historyKeys = (
    <>
      {capped(
        <button
          type="button"
          className="rc-key rc-key-action"
          onClick={undo}
          disabled={!history.canUndo}
          title={`${copy.editor.undo} (${MOD_KEY}Z)`}
          aria-label={copy.editor.undo}
        >
          <IconUndo className="rc-key-icon" />
        </button>,
        copy.editor.undo,
      )}
      {capped(
        <button
          type="button"
          className="rc-key rc-key-action"
          onClick={redo}
          disabled={!history.canRedo}
          title={`${copy.editor.redo} (${MOD_KEY}⇧Z)`}
          aria-label={copy.editor.redo}
        >
          <IconRedo className="rc-key-icon" />
        </button>,
        copy.editor.redo,
      )}
    </>
  );

  const exportPng = () =>
    exportPageAsPng(page, `teletext-${pageNumber ?? 100}.png`, pageNumber ?? 100);

  const exportKey = (wide: boolean) => {
    const key = (
      <button
        type="button"
        className={`rc-key ${wide ? "rc-key-wide" : "rc-key-action"}`}
        onClick={exportPng}
        title={copy.editor.exportPng}
        aria-label={copy.editor.exportPng}
      >
        <IconExport className="rc-key-icon" />
        {wide && <span>{copy.editor.exportKey}</span>}
      </button>
    );
    return wide ? key : capped(key, "PNG");
  };

  /** The cell lines over the page: a switch, lit while they show. */
  const gridKey = (wide: boolean) => {
    const key = (
      <button
        type="button"
        className={`rc-key ${wide ? "rc-key-wide" : "rc-key-action"}${showGrid ? " rc-key-lit" : ""}`}
        onClick={() => setShowGrid((on) => !on)}
        aria-pressed={showGrid}
        title={`${copy.editor.showGridHint} (Alt+G)`}
        aria-label={copy.editor.showGridHint}
      >
        <IconGrid className="rc-key-icon" />
        {wide && <span>{copy.editor.showGrid}</span>}
      </button>
    );
    return wide ? key : capped(key, copy.editor.showGrid);
  };

  /** Another page laid over this one, as one step undo can take back. */
  const copyFrom = (fromPage: number, fromSubpage: number): boolean => {
    const source = readPage?.(fromPage, fromSubpage);
    if (source == null) return false;
    transact(() => {
      for (let i = COLS; i < TOTAL_CELLS; i++) writeCell(i, source[i]);
    });
    return true;
  };

  const copyFromKey = (wide: boolean) => {
    if (readPage == null) return null;
    const key = (
      <CopyFromKey
        className={`rc-key ${wide ? "rc-key-wide" : "rc-key-action"}`}
        // A new subpage usually starts as the one before it.
        suggestion={subpage > 1 ? `${pageNumber}.${subpage - 1}` : ""}
        onCopy={copyFrom}
        inline={wide}
      >
        <IconCopyPage className="rc-key-icon" />
        {wide && <span>{copy.editor.copyFrom}</span>}
      </CopyFromKey>
    );
    return wide ? key : capped(key, copy.editor.copyFrom);
  };

  /* ── the phone's magnifier ──────────────────────────────────────────────── */

  const zoomOn = zoomed && isNarrow;
  /** The part of the page in view, in fractions of the whole: the map's window. */
  const [view, setView] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const readView = useCallback(() => {
    const stage = stageRef.current;
    if (stage == null) return;
    setView({
      x: stage.scrollLeft / stage.scrollWidth,
      y: stage.scrollTop / stage.scrollHeight,
      w: stage.clientWidth / stage.scrollWidth,
      h: stage.clientHeight / stage.scrollHeight,
    });
  }, []);
  useEffect(() => {
    if (zoomOn) readView();
  }, [zoomOn, readView]);

  /** A finger on the map puts the middle of the view under it. */
  const panTo = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (stage == null) return;
    const map = event.currentTarget.getBoundingClientRect();
    stage.scrollTo(
      ((event.clientX - map.left) / map.width) * stage.scrollWidth - stage.clientWidth / 2,
      ((event.clientY - map.top) / map.height) * stage.scrollHeight - stage.clientHeight / 2,
    );
  };

  // Typing magnified: the view follows the cursor, or the third word typed
  // would be off the edge of it.
  useEffect(() => {
    const stage = stageRef.current;
    const grid = gridRef.current;
    if (!zoomOn || tool !== "text" || stage == null || grid == null) return;
    const { col, row } = rowColFromIndex(cursorIndex);
    const box = grid.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const x = box.left - frame.left + ((col + 0.5) / COLS) * box.width;
    const y = box.top - frame.top + ((row + 0.5) / ROWS) * box.height;
    const margin = 24;
    if (x < margin || x > frame.width - margin || y < margin || y > frame.height - margin) {
      stage.scrollBy(x - frame.width / 2, y - frame.height / 2);
    }
  }, [zoomOn, tool, cursorIndex]);

  /*
   * Clearing the page asks first — and undo can take it back, too. The cap is
   * an ordinary one with a red picture on it: red is for the answer that does
   * it, not for a key that only asks.
   */
  const clearKey = (wide: boolean) => {
    const key = (
      <ConfirmKey
        className={`rc-key ${wide ? "rc-key-wide" : "rc-key-action"} rc-key-caution`}
        title={copy.editor.clearPage}
        question={copy.editor.clearConfirm}
        yes={copy.editor.clearYes}
        no={copy.editor.clearNo}
        onConfirm={clearPage}
        inline={wide}
        align="end"
      >
        <IconTrash className="rc-key-icon" />
        {wide && <span>{copy.editor.clearYes}</span>}
      </ConfirmKey>
    );
    return wide ? key : capped(key, copy.editor.clearYes);
  };

  /* ── the page ───────────────────────────────────────────────────────────── */

  const overlay = (
    <>
      {showGrid && <div className="editor-gridlines" />}
      {tool === "select" && selection != null && (
        <div className="editor-selection" style={overlayBox(selection)} />
      )}
      {ghost != null && (
        <div className="editor-selection editor-selection-ghost" style={overlayBox(ghost)} />
      )}
      {remoteCursors?.map((rc) => {
        const color = resolveCursorColor(rc.color);
        return (
          <div
            key={`${rc.name}-${rc.index}`}
            className="editor-remote-cursor"
            style={{
              ...overlayBox({ ...rowColFromIndex(rc.index), width: 1, height: 1 }),
              outlineColor: color,
            }}
          >
            <span className="editor-remote-cursor-label" style={{ background: color }}>
              {rc.name}
            </span>
          </div>
        );
      })}
    </>
  );

  const stage = (
    <div className="rc-stage-wrap">
    <main
      className={`rc-stage${zoomOn ? " rc-stage-zoomed" : ""}`}
      ref={stageRef}
      onScroll={zoomOn ? readView : undefined}
    >
      {/*
        * The set the page is drawn on: the same moulded bezel, sunk tube and
        * badge the page is watched in on /watch, so the two screens are one
        * appliance. The badge is what tells you so; nothing else about the
        * frame is decoration.
        */}
      <div className="rc-bezel">
        <div
          ref={gridRef}
          className={`teletext-screen-wrapper${tool === "blink" ? " show-blink-marks" : ""}${
            brushMode === "picker" || brushMode === "select"
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
          aria-label={copy.editor.grid}
        >
          <input
            ref={hiddenInputRef}
            type="text"
            className="editor-hidden-input"
            aria-hidden
            tabIndex={-1}
            /* Keeps the input focusable — and so still fed by a real keyboard —
               without the system's on-screen one sliding up over the page. The
               panel's own keyboard is what types here instead; see `textPad`. */
            inputMode={isNarrow ? "none" : undefined}
            onKeyDown={handleKeyDown}
            onInput={handleHiddenInput}
            onCopy={(e) => handleCopy(e, false)}
            onCut={(e) => handleCopy(e, true)}
            onPaste={handlePaste}
          />
          <TeletextGrid
            page={page}
            pageNumber={pageNumber ?? 100}
            subpage={subpage}
            subpageCount={subpageCount}
            cursorIndex={
              brushMode === "select" ? null : isBrushActive ? hoveredCellIndex : cursorIndex
            }
            hoverPartIndex={brushMode === "pixel" ? hoveredPartIndex : null}
            cursorDoubleHeight={brushMode === "off" && doubleHeightOn}
            onPointerCell={handlePointerCell}
            onPointerEnd={endStroke}
            readOnly={false}
            overlay={overlay}
          />
        </div>
        <span className="rc-nameplate" aria-hidden>
          Teletextron
        </span>
      </div>
    </main>
      {/*
        * A sixth of a cell is about two pixels across on a phone. The key
        * doubles the page; the map beside it says which part is in view and
        * moves it, since a finger on the page itself is a brush.
        */}
      {isNarrow && (
        <div className="rc-zoom" onMouseDown={keepGridFocus}>
          <button
            type="button"
            className={`rc-key rc-key-small${zoomed ? " rc-key-lit" : ""}`}
            onClick={() => setZoomed((on) => !on)}
            aria-pressed={zoomed}
            title={copy.editor.zoom}
            aria-label={copy.editor.zoom}
          >
            <span className="rc-glyph">2×</span>
          </button>
          {zoomOn && (
            <div
              className="rc-zoom-map"
              aria-label={copy.editor.zoomMap}
              onPointerDown={(event) => {
                panTo(event);
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 0) panTo(event);
              }}
            >
              <span
                className="rc-zoom-view"
                style={{
                  left: `${view.x * 100}%`,
                  top: `${view.y * 100}%`,
                  width: `${view.w * 100}%`,
                  height: `${view.h * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ── the phone ──────────────────────────────────────────────────────────── */

  /* Nine pictures and no room for nine captions, and a thumb has no hover: the
     tool in hand is named at the head of its settings. */
  const toolName = (
    <p className="rc-dock-toolname" aria-live="polite">
      {toolWord(copy, toolInHand.label)}
    </p>
  );

  if (isNarrow) {
    return (
      <div className="editor-console rc-layout rc-layout-narrow">
        {/*
          * The strip, cut down to what a thumb reaches for between strokes:
          * which page this is, the rockers off it, undo, and the sheet with
          * everything else about the page.
          */}
        <header className="rc-strip rc-strip-narrow" onMouseDown={keepGridFocus}>
          {nameplate}
          {pageDisplay?.(sheet)}
          <div className="rc-strip-actions">
            {historyKeys}
            <button
              type="button"
              className="rc-key rc-key-square"
              onClick={openSheet}
              aria-haspopup="dialog"
              aria-expanded={sheetShown}
              title={copy.editor.pageSetupHint}
              aria-label={copy.editor.pageSetupHint}
            >
              <IconPage className="rc-key-icon" />
            </button>
          </div>
        </header>
        {alert}

        {stage}

        {/*
          * The handset: the tool in hand's settings, the keyboard when typing,
          * and the tool keys along the foot where a thumb rests. The keys and
          * the keyboard stay put; only the settings above them scroll.
          */}
        <div className="rc-dock" onMouseDown={keepGridFocus}>
          {/*
            * Typing leaves the settings one line of height above the keyboard,
            * so they are one line: the tool's name and three keys, and a key
            * pressed turns the line into the eight colours to choose from. The
            * two palettes stacked there were a scrolling strip a finger high.
            * Every other tool has the keyboard's room, and scrolls if it must.
            */}
          {tool === "text" && !picking ? (
            <div className="rc-textbar">
              {textPick == null ? (
                <>
                  {toolName}
                  {(["fg", "bg"] as const).map((which) => (
                    <button
                      key={which}
                      type="button"
                      className="rc-key"
                      onClick={() => setTextPick(which)}
                    >
                      <span className={`rc-chip teletext-bg-${which === "fg" ? fg : bg}`} aria-hidden />
                      <span>{which === "fg" ? copy.editor.color : copy.editor.background}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`rc-key${doubleHeightOn ? " rc-key-lit" : ""}`}
                    onClick={() => setDoubleHeightOn((v) => !v)}
                    aria-pressed={doubleHeightOn}
                    aria-label={copy.editor.doubleHeight}
                    title={copy.editor.doubleHeightHint}
                  >
                    <IconDoubleHeight className="rc-key-icon" />
                  </button>
                </>
              ) : (
                <>
                  <span className="rc-sublegend">
                    {textPick === "fg" ? copy.editor.color : copy.editor.background}
                  </span>
                  {palette(
                    textPick === "fg" ? fg : bg,
                    (color) => {
                      (textPick === "fg" ? setFg : setBg)(color);
                      setTextPick(null);
                    },
                    (c) => c,
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="rc-dock-options">
              {toolName}
              {toolOptions}
            </div>
          )}
          {tool === "text" && <div className="rc-dock-keyboard">{textPad}</div>}
          <nav className="rc-dock-tools">{toolKeys}</nav>
        </div>

        {sheetShown && (
          <div
            className="rc-sheet-backdrop"
            // A click rather than a pointerdown: closing on the way down would
            // hand the way up to whatever is under the backdrop — the page.
            onClick={(event) => {
              if (event.target === event.currentTarget) closeSheet();
            }}
          >
            <div
              className="rc-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={copy.editor.pageSetup}
              onMouseDown={keepGridFocus}
            >
              <div className="rc-sheet-head">
                <h2 className="rc-legend">{copy.editor.pageSetup}</h2>
                <button
                  type="button"
                  className="rc-key rc-key-square"
                  onClick={closeSheet}
                  aria-label={copy.editor.close}
                >
                  <span aria-hidden>✕</span>
                </button>
              </div>
              <div className="rc-sheet-body">
                {pageKeypad != null && (
                  <section className="rc-cluster">{pageKeypad(sheet)}</section>
                )}
                {pageDetails != null && (
                  <section className="rc-cluster">{pageDetails}</section>
                )}
                {people}
                <section className="rc-cluster">
                  <div className="rc-keyrow">
                    {gridKey(true)}
                    {copyFromKey(true)}
                  </div>
                  <div className="rc-keyrow">
                    {exportKey(true)}
                    {clearKey(true)}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── the desk ───────────────────────────────────────────────────────────── */

  return (
    <div className="editor-console rc-layout">
      <header className="rc-strip" onMouseDown={keepGridFocus}>
        {nameplate != null && (
          <div className="rc-strip-group rc-strip-nameplate">{nameplate}</div>
        )}
        {pageDisplay != null && (
          <div className="rc-strip-group" role="group" aria-label={copy.editor.page}>
            {pageDisplay(sheet)}
          </div>
        )}
        {pageDetails != null && (
          <div className="rc-strip-group rc-strip-details">{pageDetails}</div>
        )}
        <div
          className="rc-strip-group rc-strip-actions"
          role="group"
          aria-label={copy.editor.wholePage}
        >
          {historyKeys}
          {gridKey(false)}
          {copyFromKey(false)}
          {exportKey(false)}
        </div>
        {/* Apart from the rest: the one key on the strip that destroys. */}
        <div className="rc-strip-group">{clearKey(false)}</div>
      </header>
      {alert}

      <div className="rc-desk">
        {/* The remote: the tool keys, then everything about the tool in hand. */}
        <aside
          className="rc-remote"
          onMouseDown={keepGridFocus}
          aria-label={copy.editor.tools}
        >
          <section className="rc-cluster rc-cluster-tools">
            {toolKeys}
          </section>
          {toolOptions}
          {people}
        </aside>
        {stage}
      </div>
    </div>
  );
}
