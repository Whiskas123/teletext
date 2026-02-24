import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTeletext } from "../../context/TeletextContext";
import {
  brushColorsFromSlots,
  COLS,
  createEmptyPage,
  DEFAULT_SIXEL_COLORS,
  indexAt,
  motifSlotCount,
  MOTIF_PATTERNS,
  ROWS,
  rowColFromIndex,
  SIXEL_MAX,
  slotColorsFromBrush,
  TELETEXT_COLORS,
  type SixelColors,
  type TeletextColor,
} from "../../types/teletext";
import { exportPageAsPng } from "../../utils/exportPng";
import { TeletextGrid } from "../TeletextGrid/TeletextGrid";

const SIXEL_TOOLTIP_MARGIN = 8;
const MOTIF_HISTORY_MAX = 8;

function motifsEqual(a: SixelColors, b: SixelColors): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}
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

interface EditorProps {
  /** When set (from grid route), show Back to grid in sidebar */
  pageNumber?: number;
  /** When set, Back to grid calls this (e.g. save then navigate) instead of navigating directly */
  onBackToGrid?: () => void | Promise<void>;
}

export function Editor({ pageNumber, onBackToGrid }: EditorProps) {
  const navigate = useNavigate();
  const { page, setPage } = useTeletext();
  const [cursorIndex, setCursorIndex] = useState(COLS);
  const [fg, setFg] = useState<TeletextColor>("white");
  const [bg, setBg] = useState<TeletextColor>("black");
  const [clearConfirmShown, setClearConfirmShown] = useState(false);
  type BrushMode = "off" | "block" | "blink";
  const [brushMode, setBrushMode] = useState<BrushMode>("off");
  const [motifColors, setMotifColors] = useState<(SixelColors | undefined)[]>(
    () => MOTIF_PATTERNS.map(() => undefined),
  );
  const [selectedMotifIndex, setSelectedMotifIndex] = useState(0);
  const [motifHistory, setMotifHistory] = useState<SixelColors[]>([]);
  const [selectedSixelIndex, setSelectedSixelIndex] = useState(0);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [colorTooltipOpen, setColorTooltipOpen] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    part: { left: number; top: number; width: number; height: number };
    preview: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);
  const isDrawingRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const sixelColorTooltipRef = useRef<HTMLDivElement>(null);
  const brushSixelPreviewRef = useRef<HTMLDivElement>(null);

  const addMotifToHistory = useCallback((motif: SixelColors) => {
    setMotifHistory((prev) => {
      const filtered = prev.filter((m) => !motifsEqual(m, motif));
      const next = [[...motif] as SixelColors, ...filtered];
      return next.slice(0, MOTIF_HISTORY_MAX);
    });
  }, []);

  const selectedMotif = MOTIF_PATTERNS[selectedMotifIndex];
  const brushColors: SixelColors =
    motifColors[selectedMotifIndex] ??
    defaultColorsForMotif(selectedMotif.slots);
  const motifSlotColors = slotColorsFromBrush(selectedMotif.slots, brushColors);

  const paintCell = useCallback(
    (index: number) => {
      setPage((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          char: " ",
          fg: "white",
          bg: "black",
          graphics: SIXEL_MAX,
          graphicsColors: [...brushColors],
        };
        return next;
      });
      setCursorIndex(index);
      addMotifToHistory(brushColors);
    },
    [brushColors, setPage, addMotifToHistory],
  );

  const paintBlinkCell = useCallback(
    (index: number, value: boolean) => {
      setPage((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], blink: value };
        return next;
      });
      setCursorIndex(index);
    },
    [setPage],
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

  const applyMotifFromHistory = useCallback(
    (motif: SixelColors) => {
      setMotifColors((prev) => {
        const n = [...prev];
        n[selectedMotifIndex] = [...motif] as SixelColors;
        return n;
      });
    },
    [selectedMotifIndex],
  );

  const selectMotif = useCallback((index: number) => {
    setSelectedMotifIndex(index);
  }, []);

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

  const handleCellClick = useCallback(
    (index: number, e?: React.MouseEvent) => {
      if (index < COLS) return;
      if (brushMode === "block" && e?.altKey) {
        pickMotifFromCell(index);
        return;
      }
      if (brushMode === "blink") {
        paintBlinkCell(index, !e?.altKey);
        return;
      }
      if (brushMode === "block") {
        paintCell(index);
      } else {
        setCursorIndex(index);
        focusHiddenInput();
      }
    },
    [brushMode, paintCell, paintBlinkCell, pickMotifFromCell, focusHiddenInput],
  );

  const handleCellMouseDown = useCallback(
    (index: number, e?: React.MouseEvent) => {
      if (index < COLS) return;
      if (brushMode === "block" && e?.altKey) {
        e?.preventDefault();
        e?.stopPropagation();
        pickMotifFromCell(index);
        return;
      }
      if (brushMode === "blink") {
        isDrawingRef.current = true;
        paintBlinkCell(index, !e?.altKey);
      } else if (brushMode === "block") {
        isDrawingRef.current = true;
        paintCell(index);
      }
    },
    [brushMode, paintCell, paintBlinkCell, pickMotifFromCell],
  );

  const handleCellMouseEnter = useCallback(
    (index: number) => {
      if (index < COLS) {
        setHoveredCellIndex(null);
        return;
      }
      if (brushMode === "block") {
        setHoveredCellIndex(index);
        if (isDrawingRef.current) paintCell(index);
      } else if (brushMode === "blink" && isDrawingRef.current) {
        paintBlinkCell(index, true);
      }
    },
    [brushMode, paintCell, paintBlinkCell],
  );

  const handleGridMouseLeave = useCallback(() => {
    setHoveredCellIndex(null);
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      isDrawingRef.current = false;
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
    (index: number, char: string) => {
      if (index < COLS) return;
      const c = getFirstGrapheme(char) || " ";
      setPage((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          char: c,
          fg,
          bg,
          graphics: null,
        };
        return next;
      });
    },
    [fg, bg, setPage],
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
          setPage((prev) => {
            const next = [...prev];
            next[cursorIndex] = {
              ...next[cursorIndex],
              char: " ",
              fg: "black",
              bg: "black",
              graphics: null,
              blink: false,
            };
            return next;
          });
          setCursorIndex(Math.max(COLS, cursorIndex - 1));
          return;
        case "Delete":
          e.preventDefault();
          setCellChar(cursorIndex, " ");
          return;
        case "ArrowLeft":
          e.preventDefault();
          setCursorIndex(Math.max(COLS, cursorIndex - 1));
          return;
        case "ArrowRight":
          e.preventDefault();
          setCursorIndex(Math.min(ROWS * COLS - 1, cursorIndex + 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          setCursorIndex(Math.max(COLS, indexAt(col, row - 1)));
          return;
        case "ArrowDown":
          e.preventDefault();
          setCursorIndex(Math.min(ROWS * COLS - 1, indexAt(col, row + 1)));
          return;
        case "Enter":
          e.preventDefault();
          setCursorIndex(Math.min(ROWS * COLS - 1, indexAt(0, row + 1)));
          return;
        case "Tab":
          e.preventDefault();
          setCursorIndex(
            Math.max(
              COLS,
              Math.min(ROWS * COLS - 1, cursorIndex + (e.shiftKey ? -1 : 1)),
            ),
          );
          return;
        default:
          if (brushMode === "block" || brushMode === "blink") {
            e.preventDefault();
            return;
          }
          if (e.key === "Dead" || e.key.length === 1) {
            return;
          }
          e.preventDefault();
      }
    },
    [cursorIndex, setCellChar, setPage, brushMode],
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
        setCellChar(cursorIndex, c);
        setCursorIndex((prev) => Math.min(ROWS * COLS - 1, prev + 1));
      }
      input.value = "";
    },
    [brushMode, cursorIndex, setCellChar],
  );

  const isBrushActive = brushMode === "block" || brushMode === "blink";

  useEffect(() => {
    hiddenInputRef.current?.focus();
    const id = setTimeout(() => hiddenInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  const handleGridBlur = useCallback(() => {
    setTimeout(() => hiddenInputRef.current?.focus(), 0);
  }, []);

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar">
        <h1 className="editor-title">TELETEXT EDITOR</h1>

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
              className={`text-preview-cell teletext-fg-${fg} teletext-bg-${bg}`}
              aria-hidden
            />
          </div>
        </section>

        <section className="sidebar-section">
          <h2 className="sidebar-heading">Brush</h2>
          <div className="brush-mode-toggles">
            <button
              type="button"
              className={`sidebar-toggle ${brushMode === "off" ? "active" : ""}`}
              onClick={() => setBrushMode("off")}
            >
              Off
            </button>
            <button
              type="button"
              className={`sidebar-toggle ${brushMode === "block" ? "active" : ""}`}
              onClick={() => setBrushMode("block")}
            >
              Block
            </button>
            <button
              type="button"
              className={`sidebar-toggle ${brushMode === "blink" ? "active" : ""}`}
              onClick={() => setBrushMode("blink")}
              title="Paint blink on cells. Alt+click to remove blink."
            >
              Blink
            </button>
          </div>
          {brushMode === "block" && (
            <div className="brush-options">
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
              {motifHistory.length > 0 && (
                <div className="color-block">
                  <span className="sidebar-field-label">Recent motifs</span>
                  <div className="motif-history">
                    {motifHistory.map((motif, idx) => (
                      <button
                        key={`${motif.join("-")}`}
                        type="button"
                        className="motif-history-btn"
                        title="Apply motif"
                        onClick={() => applyMotifFromHistory(motif)}
                        aria-label={`Apply recent motif ${idx + 1}`}
                      >
                        <div className="preset-motif-preview">
                          {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                            <span
                              key={i}
                              className={`preset-motif-dot teletext-bg-${motif[i]}`}
                            />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
          {brushMode === "blink" && (
            <p className="sidebar-hint">
              Click or drag to set blink on. Alt + click to remove blink.
            </p>
          )}
        </section>

        <section className="sidebar-section sidebar-actions">
          {pageNumber != null && (
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={async () => {
                if (onBackToGrid) {
                  await onBackToGrid();
                } else {
                  navigate("/");
                }
              }}
            >
              Back to grid
            </button>
          )}
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={() =>
              exportPageAsPng(page, "teletext.png", pageNumber ?? 100)
            }
          >
            Export PNG
          </button>
          {clearConfirmShown ? (
            <div className="clear-confirm">
              <span className="clear-confirm-label">Are you sure?</span>
              <div className="clear-confirm-buttons">
                <button
                  type="button"
                  className="sidebar-action-btn sidebar-action-btn-clear"
                  onClick={() => {
                    setPage(createEmptyPage());
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
              Clear page
            </button>
          )}
        </section>
      </aside>

      <div className="editor-main">
        <div
          ref={gridRef}
          className={`teletext-screen-wrapper${isBrushActive ? " brush-cursor" : ""}`}
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
            cursorIndex={isBrushActive ? hoveredCellIndex : cursorIndex}
            onCellClick={handleCellClick}
            onCellMouseDown={handleCellMouseDown}
            onCellMouseEnter={handleCellMouseEnter}
            readOnly={false}
          />
        </div>
      </div>
    </div>
  );
}
