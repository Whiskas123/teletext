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
  IconBlink,
  IconBlock,
  IconDoubleHeight,
  IconBrush,
  IconEraser,
  IconExport,
  IconPage,
  IconPipette,
  IconPixel,
  IconRedo,
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
import { useCopy } from "../Room/useCopy";
import type { Copy } from "../../domain/copy";
import { TeletextGrid } from "../TeletextGrid/TeletextGrid";
import { ConfirmKey } from "./ConfirmKey";
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
type BrushMode = "off" | "block" | "pixel" | "blink" | "picker";

/**
 * The three tool keys.
 *
 * There were five, and they were three different kinds of thing in one row:
 * what you are making (text or mosaic), how big a brush (a whole cell or one
 * sixth of one) and an effect (blink) — with the eyedropper, which is not a
 * tool at all but a way of choosing colours, on the end. Now the row is only
 * *what you are doing*; the brush size is a switch inside Draw, and the
 * eyedropper sits beside the colours it fills in.
 *
 * The words are looked up rather than written here: this table is the order
 * the keys are moulded in, which is not language.
 */
type Tool = "text" | "draw" | "blink";

const TOOL_KEYS: readonly {
  tool: Tool;
  label: keyof Copy["editor"];
  title: keyof Copy["editor"];
  Icon: (props: { className?: string }) => React.ReactElement;
}[] = [
  { tool: "text", label: "toolText", title: "toolTextHint", Icon: IconTextCursor },
  { tool: "draw", label: "toolDraw", title: "toolDrawHint", Icon: IconBlock },
  { tool: "blink", label: "toolBlink", title: "toolBlinkHint", Icon: IconBlink },
];

/** Resolve one of {@link TOOL_KEYS}' copy keys to the words themselves. */
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
      for (let i = 0; i < TOTAL_CELLS; i++) writeCell(i, emptyCellValue());
    });
  }, [transact, writeCell]);

  const [fg, setFg] = useState<TeletextColor>("white");
  const [bg, setBg] = useState<TeletextColor>("black");
  /** When on, typed characters render at double the row height (text only — not the block/pixel brushes). */
  const [doubleHeightOn, setDoubleHeightOn] = useState(false);
  const [tool, setTool] = useState<Tool>("text");
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
      setTool(next);
      setPicking(false);
    },
    [tool],
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

  /** The block brush's eraser: the cell goes back to an empty one. */
  const eraseCell = useCallback(
    (index: number) => {
      const cell = page[index];
      if (cell.graphics != null || cell.char !== " " || cell.bg !== "black") {
        writeCell(index, emptyCellValue());
      }
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
    history.commit();
  }, [history]);

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
        {padCap("◀", () => applyControlKey("ArrowLeft"), { aria: "Cursor left" })}
        {padCap("▶", () => applyControlKey("ArrowRight"), { aria: "Cursor right" })}
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
      {TOOL_KEYS.map(({ tool: key, label, title, Icon }) => (
        <div className="rc-keycap" key={key}>
          <button
            type="button"
            role="radio"
            aria-checked={tool === key}
            aria-label={toolWord(copy, label)}
            className={`rc-key rc-key-tool${tool === key ? " rc-key-lit" : ""}`}
            onClick={() => selectTool(key)}
            title={toolWord(copy, title)}
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
    value: TeletextColor,
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

  /*
   * The eyedropper, beside the colours it fills in.
   *
   * It is a way of choosing colours, not a thing to do to the page, so it
   * lives with the palettes rather than in the row of tools. Pressed, the next
   * cell touched hands over what made it — and the panel follows: a character
   * lands you in Write with its colours, a mosaic in Draw with its shape.
   */
  const eyedropper = (
    <button
      type="button"
      className={`rc-key rc-key-small${picking ? " rc-key-lit" : ""}`}
      onClick={() => setPicking((up) => !up)}
      aria-pressed={picking}
      title={copy.editor.eyedropperHint}
      aria-label={copy.editor.eyedropper}
    >
      <IconPipette className="rc-key-icon" />
    </button>
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
        {/* On a phone the keyboard needs the height a heading would take, so
            the eyedropper moves down beside the double-height key. */}
        {!isNarrow && clusterHead(copy.editor.colours, eyedropper)}
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
          {isNarrow && eyedropper}
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
    <section className={`rc-cluster${eraseOn ? " rc-idle" : ""}`}>
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
      {/*
        * Paint or erase first, then the size of the brush — two separate
        * questions, asked separately. Erasing is the same switch as on Blink,
        * in the same place, so the two tools read the same way.
        */}
      <section className="rc-cluster">
        {segmented(
          copy.editor.toolDraw,
          eraseOn ? "erase" : "paint",
          [
            { value: "paint", label: copy.editor.paint, icon: <IconBrush className="rc-key-icon" /> },
            { value: "erase", label: copy.editor.erase, icon: <IconEraser className="rc-key-icon" /> },
          ] as const,
          (value) => setEraseOn(value === "erase"),
        )}
      </section>

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

      {/* What the brush is loaded with. Still shown while erasing, dimmed, so
          the panel does not jump — and choosing from it goes back to painting. */}
      {drawSize === "cell" && motifCluster}

      <section className={`rc-cluster${eraseOn ? " rc-idle" : ""}`}>
        {clusterHead(copy.editor.colours, eyedropper)}
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
    </section>
  );

  const toolOptions =
    tool === "text" ? textOptions : tool === "draw" ? drawOptions : blinkOptions;

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

  const stage = (
    <main className="rc-stage">
      {/*
        * The set the page is drawn on: the same moulded bezel, sunk tube and
        * badge the page is watched in on /watch, so the two screens are one
        * appliance. The badge is what tells you so; nothing else about the
        * frame is decoration.
        */}
      <div className="rc-bezel">
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
        <span className="rc-nameplate" aria-hidden>
          Teletextron
        </span>
      </div>
    </main>
  );

  /* ── the phone ──────────────────────────────────────────────────────────── */

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
          <div className="rc-dock-options">
            {toolOptions}
          </div>
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
                <section className="rc-cluster">
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
        </aside>
        {stage}
      </div>
    </div>
  );
}
