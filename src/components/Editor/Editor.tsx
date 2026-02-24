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
  const [brushMode, setBrushMode] = useState(false);
  const [brushColors, setBrushColors] = useState<SixelColors>(
    () => [...DEFAULT_SIXEL_COLORS] as SixelColors,
  );
  const [selectedMotifIndex, setSelectedMotifIndex] = useState(0);
  const [motifHistory, setMotifHistory] = useState<SixelColors[]>([]);
  const [selectedSixelIndex, setSelectedSixelIndex] = useState(0);
  const [colorTooltipOpen, setColorTooltipOpen] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    part: { left: number; top: number; width: number; height: number };
    preview: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);
  const isDrawingRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const sixelColorTooltipRef = useRef<HTMLDivElement>(null);
  const brushSixelPreviewRef = useRef<HTMLDivElement>(null);

  const addMotifToHistory = useCallback((motif: SixelColors) => {
    setMotifHistory((prev) => {
      const filtered = prev.filter((m) => !motifsEqual(m, motif));
      const next = [[...motif] as SixelColors, ...filtered];
      return next.slice(0, MOTIF_HISTORY_MAX);
    });
  }, []);

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

  const setAllBrushColors = useCallback((color: TeletextColor) => {
    setBrushColors([color, color, color, color, color, color] as SixelColors);
  }, []);

  const selectedMotif = MOTIF_PATTERNS[selectedMotifIndex];
  const motifSlotColors = slotColorsFromBrush(selectedMotif.slots, brushColors);

  const setMotifSlotColor = useCallback(
    (slotIndex: number, color: TeletextColor) => {
      const slots = selectedMotif.slots;
      const next = [...motifSlotColors];
      next[slotIndex] = color;
      setBrushColors(brushColorsFromSlots(slots, next));
    },
    [selectedMotif, motifSlotColors],
  );

  const applyMotifFromHistory = useCallback((motif: SixelColors) => {
    setBrushColors([...motif] as SixelColors);
  }, []);

  const selectMotif = useCallback((index: number) => {
    setSelectedMotifIndex(index);
  }, []);

  const pickMotifFromCell = useCallback(
    (index: number) => {
      const cell = page[index];
      if (
        cell &&
        typeof cell.graphics === "number" &&
        cell.graphicsColors
      ) {
        setBrushColors([...cell.graphicsColors] as SixelColors);
      }
    },
    [page],
  );

  const handleCellClick = useCallback(
    (index: number, e?: React.MouseEvent) => {
      if (index < COLS) return;
      if (brushMode && e?.altKey) {
        pickMotifFromCell(index);
        return;
      }
      if (brushMode) {
        paintCell(index);
      } else {
        setCursorIndex(index);
        gridRef.current?.focus();
      }
    },
    [brushMode, paintCell, pickMotifFromCell],
  );

  const handleCellMouseDown = useCallback(
    (index: number, e?: React.MouseEvent) => {
      if (index < COLS) return;
      if (brushMode && e?.altKey) {
        pickMotifFromCell(index);
        return;
      }
      if (brushMode) {
        isDrawingRef.current = true;
        paintCell(index);
      }
    },
    [brushMode, paintCell, pickMotifFromCell],
  );

  const handleCellMouseEnter = useCallback(
    (index: number) => {
      if (index < COLS) {
        setHoveredCellIndex(null);
        return;
      }
      if (brushMode) {
        setHoveredCellIndex(index);
        if (isDrawingRef.current) paintCell(index);
      }
    },
    [brushMode, paintCell],
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
      const c = char.length === 1 ? char : (char[0] ?? " ");
      setPage((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], char: c, fg, bg, graphics: null };
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
          if (e.key.length === 1) {
            e.preventDefault();
            setCellChar(cursorIndex, e.key);
            setCursorIndex(Math.min(ROWS * COLS - 1, cursorIndex + 1));
          }
      }
    },
    [cursorIndex, setCellChar, setPage],
  );

  // Keep the teletext screen focused so arrow keys work without clicking it first
  useEffect(() => {
    gridRef.current?.focus();
    const id = setTimeout(() => gridRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  const handleGridBlur = useCallback(() => {
    // Refocus the grid so arrow keys keep working after clicking sidebar, etc.
    setTimeout(() => gridRef.current?.focus(), 0);
  }, []);

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar">
        <h1 className="editor-title">TELETEXT EDITOR</h1>

        <section className="sidebar-section">
          <h2 className="sidebar-heading">Text colors</h2>
          <div className="color-block">
            <span className="sidebar-field-label">Foreground</span>
            <div className="color-swatches">
              {TELETEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch teletext-bg-${color} ${fg === color ? "active" : ""}`}
                  title={color}
                  onClick={() => setFg(color)}
                  aria-label={`Foreground ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="color-block">
            <span className="sidebar-field-label">Background</span>
            <div className="color-swatches">
              {TELETEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch teletext-bg-${color} ${bg === color ? "active" : ""}`}
                  title={color}
                  onClick={() => setBg(color)}
                  aria-label={`Background ${color}`}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="sidebar-section">
          <h2 className="sidebar-heading">Block graphics</h2>
          <button
            type="button"
            className={`sidebar-toggle ${brushMode ? "active" : ""}`}
            onClick={() => setBrushMode((v) => !v)}
          >
            {brushMode ? "Brush on" : "Brush off"}
          </button>
          {brushMode && (
            <div className="brush-options">
              <div className="color-block">
                <span className="sidebar-field-label">
                  Motif pattern
                </span>
                <div className="preset-motifs">
                  {MOTIF_PATTERNS.map((pattern, idx) => {
                    const slotColors = slotColorsFromBrush(pattern.slots, brushColors);
                    const previewColors = brushColorsFromSlots(pattern.slots, slotColors);
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
                      const rightNeighbor = i <= 2 ? i + 3 : null;
                      const bottomNeighbor = i === 0 ? 1 : i === 1 ? 2 : i === 3 ? 4 : i === 4 ? 5 : null;
                      const borderRight = rightNeighbor !== null && slots[i] !== slots[rightNeighbor];
                      const borderBottom = bottomNeighbor !== null && slots[i] !== slots[bottomNeighbor];
                      return (
                      <button
                        key={i}
                        type="button"
                        className={`brush-sixel-part brush-sixel-part-slot-${slotIndex} teletext-bg-${brushColors[i]} ${borderRight ? "brush-sixel-part-border-r" : ""} ${borderBottom ? "brush-sixel-part-border-b" : ""} ${selectedSixelIndex === i && colorTooltipOpen ? "brush-sixel-part-active" : ""}`}
                        title={`Part ${i + 1}`}
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
                  <span className="sidebar-field-label">Set all parts</span>
                  <div className="color-swatches">
                    {TELETEXT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`color-swatch teletext-bg-${color}`}
                        title={color}
                        onClick={() => setAllBrushColors(color)}
                        aria-label={`All parts ${color}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              {motifHistory.length > 0 && (
                <div className="color-block">
                  <span className="sidebar-field-label">
                    Recent motifs
                  </span>
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
                  Pick from grid (Alt+click)
                </span>
                <p className="sidebar-hint">
                  Hold Alt and click a block on the grid to copy its motif.
                </p>
              </div>
            </div>
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
            onClick={() => exportPageAsPng(page, 'teletext.png', pageNumber ?? 100)}
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
          className={`teletext-screen-wrapper${brushMode ? " brush-cursor" : ""}`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onBlur={handleGridBlur}
          onMouseLeave={handleGridMouseLeave}
          role="application"
          aria-label="Teletext editor grid"
        >
          <TeletextGrid
            page={page}
            pageNumber={pageNumber ?? 100}
            cursorIndex={brushMode ? hoveredCellIndex : cursorIndex}
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
