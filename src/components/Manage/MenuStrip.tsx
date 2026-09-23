/**
 * A bottom bar drawn as the forty cells it becomes.
 *
 * Rendered by `renderMenuRow` — the same function the server uses to write
 * the bar onto a page — so the preview in a list or a picker is exactly what
 * lands. Text, not a canvas: forty spans are cheap, and it scales with the
 * layout.
 */

import { renderMenuRow, type MenuItem } from '../../domain/menu';
import { TELETEXT_COLOR_HEX } from '../../types/teletext';

export function MenuStrip({ items, label }: { items: readonly MenuItem[]; label?: string }) {
  const row = renderMenuRow({ items: [...items] });
  return (
    <div className="mg-strip" role="img" aria-label={label ?? 'Bottom bar preview'}>
      {row.map((cell, index) => (
        <span key={index} style={{ color: TELETEXT_COLOR_HEX[cell.fg] }}>
          {cell.char}
        </span>
      ))}
    </div>
  );
}
