/**
 * What the editor remembers between visits, in this browser: the recent
 * brushes and text styles, and whether the cell grid is shown.
 *
 * Read tolerantly — it is this browser's own storage, but an older build, a
 * private window or a full disk can all leave it missing or misshapen, and
 * none of those should cost anybody the editor.
 */

import { BRUSH_HISTORY_MAX, type Brush } from '../../domain/brush';
import { TEXT_STYLE_HISTORY_MAX, type TextStyle } from '../../domain/textStyle';
import { MOTIF_PATTERNS, SIXEL_MAX, TELETEXT_COLORS, type TeletextColor } from '../../types/teletext';

const KEY = 'teletext:editorPrefs';

export interface EditorPrefs {
  brushes: Brush[];
  textStyles: TextStyle[];
  showGrid: boolean;
}

const isColor = (value: unknown): value is TeletextColor =>
  (TELETEXT_COLORS as readonly unknown[]).includes(value);

function isBrush(value: unknown): value is Brush {
  const brush = value as Brush | null;
  if (brush?.kind === 'pixel') return isColor(brush.color);
  return (
    brush?.kind === 'block' &&
    MOTIF_PATTERNS[brush.motifIndex] != null &&
    Number.isInteger(brush.pattern) &&
    brush.pattern >= 0 &&
    brush.pattern <= SIXEL_MAX &&
    Array.isArray(brush.colors) &&
    brush.colors.length === 6 &&
    brush.colors.every(isColor)
  );
}

function isTextStyle(value: unknown): value is TextStyle {
  const style = value as TextStyle | null;
  return style != null && isColor(style.fg) && isColor(style.bg) && typeof style.doubleHeight === 'boolean';
}

export function loadEditorPrefs(): EditorPrefs {
  let raw: Partial<Record<keyof EditorPrefs, unknown>> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // Unreadable is the same as empty.
  }
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    brushes: list(raw.brushes).filter(isBrush).slice(0, BRUSH_HISTORY_MAX),
    textStyles: list(raw.textStyles).filter(isTextStyle).slice(0, TEXT_STYLE_HISTORY_MAX),
    showGrid: raw.showGrid === true,
  };
}

export function saveEditorPrefs(prefs: EditorPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
