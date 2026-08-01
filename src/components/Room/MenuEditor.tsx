/**
 * The saved four-colour menu strips, and the editor for them.
 *
 * A teletext page ends with four coloured links — red, green, yellow, cyan —
 * and captures arrive with whatever strip they were broadcast with, pointing at
 * page numbers that mean nothing in this archive. Replacing that strip is
 * something you do to dozens of pages, so the strips are named, saved and
 * picked from a list rather than retyped, which is how they end up inconsistent.
 *
 * The preview is rendered by `applyMenu` — the same function the server uses
 * when publishing — so what is shown here is exactly what lands on the page.
 */

import { useCallback, useState } from 'react';

import {
  MAX_MENU_LABEL,
  MENU_COLORS,
  emptyMenuDraft,
  menuPreviewPage,
  type CustomMenu,
  type MenuDraft,
} from '../../domain/menu';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';

export interface MenuEditorProps {
  menus: CustomMenu[];
  /** Currently applied menu, or `null` to keep the capture's own strip. */
  selectedId: number | null;
  onSelect(id: number | null): void;
  onSave(draft: MenuDraft & { id?: number }): Promise<{ ok: true } | { ok: false; error: string }>;
  onDelete(id: number): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function MenuEditor({
  menus,
  selectedId,
  onSelect,
  onSave,
  onDelete,
}: MenuEditorProps) {
  const [editing, setEditing] = useState<(MenuDraft & { id?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startNew = useCallback(() => {
    setError(null);
    setEditing(emptyMenuDraft());
  }, []);

  const startEdit = useCallback((menu: CustomMenu) => {
    setError(null);
    // Copied, so abandoning the edit leaves the saved menu untouched.
    setEditing({ id: menu.id, name: menu.name, items: menu.items.map((i) => ({ ...i })) });
  }, []);

  const save = useCallback(async () => {
    if (editing == null) return;
    setBusy(true);
    const result = await onSave(editing);
    setBusy(false);
    if (result.ok) {
      setEditing(null);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [editing, onSave]);

  const remove = useCallback(
    async (menu: CustomMenu) => {
      setBusy(true);
      const result = await onDelete(menu.id);
      setBusy(false);
      if (!result.ok) setError(result.error);
      else if (selectedId === menu.id) onSelect(null);
    },
    [onDelete, onSelect, selectedId],
  );

  return (
    <div className="menu-editor">
      <div className="menu-editor-head">
        <label className="sidebar-field-label" htmlFor="menu-pick">
          Bottom menu
        </label>
        <select
          id="menu-pick"
          value={selectedId ?? ''}
          onChange={(e) => onSelect(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Keep the capture&rsquo;s own strip</option>
          {menus.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.name}
            </option>
          ))}
        </select>
        <button type="button" className="manage-mini-btn" onClick={startNew}>
          New
        </button>
        {selectedId != null && (
          <button
            type="button"
            className="manage-mini-btn"
            onClick={() => {
              const menu = menus.find((m) => m.id === selectedId);
              if (menu != null) startEdit(menu);
            }}
          >
            Edit
          </button>
        )}
      </div>

      {editing != null && (
        <div className="menu-editor-form">
          <label className="sidebar-field-label" htmlFor="menu-name">
            Menu name
          </label>
          <input
            id="menu-name"
            className="landing-name-input"
            value={editing.name}
            placeholder="e.g. Main navigation"
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />

          <div className="menu-editor-slots">
            {MENU_COLORS.map((color, slot) => (
              <div key={color} className="menu-editor-slot">
                <span className={`menu-swatch menu-swatch-${color}`} aria-hidden />
                <input
                  aria-label={`${color} label`}
                  className="landing-name-input"
                  maxLength={MAX_MENU_LABEL}
                  placeholder={color}
                  value={editing.items[slot]?.label ?? ''}
                  onChange={(e) => {
                    const items = editing.items.map((i) => ({ ...i }));
                    items[slot] = { ...items[slot], label: e.target.value };
                    setEditing({ ...editing, items });
                  }}
                />
                <input
                  aria-label={`${color} page`}
                  className="landing-name-input menu-editor-page"
                  type="number"
                  min={100}
                  max={999}
                  placeholder="page"
                  value={editing.items[slot]?.pageNumber ?? ''}
                  onChange={(e) => {
                    const items = editing.items.map((i) => ({ ...i }));
                    items[slot] = {
                      ...items[slot],
                      pageNumber: e.target.value === '' ? null : Number(e.target.value),
                    };
                    setEditing({ ...editing, items });
                  }}
                />
              </div>
            ))}
          </div>

          {/* Rendered by the same function that publishes it. */}
          <div className="manage-preview manage-preview-strip">
            <TeletextGrid page={menuPreviewPage(editing)} readOnly />
          </div>

          {error != null && (
            <p className="room-entry-error" role="alert">
              {error}
            </p>
          )}

          <div className="menu-editor-actions">
            <button
              type="button"
              className="sidebar-action-btn"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : editing.id == null ? 'Create menu' : 'Save changes'}
            </button>
            <button
              type="button"
              className="manage-mini-btn"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancel
            </button>
            {editing.id != null && (
              <button
                type="button"
                className="manage-mini-btn manage-mini-btn-danger"
                disabled={busy}
                onClick={() => {
                  const menu = menus.find((m) => m.id === editing.id);
                  if (menu != null) void remove(menu);
                  setEditing(null);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MenuEditor;
