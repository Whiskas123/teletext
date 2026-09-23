/**
 * The saved bottom bars: four coloured links, named, and reused across pages.
 *
 * A capture arrives with whatever fastext row it was broadcast with, pointing
 * at page numbers that mean nothing here. A saved bar replaces it, and the
 * same bar goes on dozens of pages — so bars are kept here, as a list with the
 * editor beside it, rather than tucked inside the publish form.
 *
 * A bar is baked into a page's cells when the page is published. Editing a bar
 * therefore does not change the pages already wearing it until they are
 * re-published, which this tab offers to do — and says how many that is.
 */

import { useMemo, useState } from 'react';

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import { describeRange } from '../../domain/lineup';
import {
  MAX_MENU_LABEL,
  MENU_COLORS,
  emptyMenuDraft,
  type CustomMenu,
  type MenuDraft,
} from '../../domain/menu';
import type { ConfirmSpec } from './Dialog';
import { MenuStrip } from './MenuStrip';

type Result = { ok: true } | { ok: false; error: string };

export interface BarsTabProps {
  menus: readonly CustomMenu[];
  published: readonly PublishedEntry[];
  locked: boolean;
  onSave(draft: MenuDraft & { id?: number }): Promise<Result>;
  onDelete(id: number): Promise<Result>;
  /** Re-publish these pages so they pick up the bar as it is now. */
  onReapply(pages: readonly number[], menuId: number): void;
  confirm(spec: ConfirmSpec): void;
}

type Editing = MenuDraft & { id?: number };

export function BarsTab({ menus, published, locked, onSave, onDelete, onReapply, confirm }: BarsTabProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  /** Pages and screens wearing each bar. */
  const usage = useMemo(() => {
    const map = new Map<number, { pages: Set<number>; screens: number }>();
    for (const entry of published) {
      if (entry.menu_id == null) continue;
      const use = map.get(entry.menu_id) ?? { pages: new Set<number>(), screens: 0 };
      use.pages.add(entry.page_number);
      use.screens += 1;
      map.set(entry.menu_id, use);
    }
    return map;
  }, [published]);

  const ownCount = published.filter((entry) => entry.menu_id == null).length;

  const edit = (menu: CustomMenu) => {
    setError(null);
    setSavedId(null);
    // Copied, so abandoning the edit leaves the saved bar untouched.
    setEditing({ id: menu.id, name: menu.name, items: menu.items.map((item) => ({ ...item })) });
  };

  const save = async () => {
    if (editing == null) return;
    setSaving(true);
    const result = await onSave(editing);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSavedId(editing.id ?? null);
    setEditing(null);
  };

  const setSlot = (slot: number, patch: Partial<MenuDraft['items'][number]>) => {
    if (editing == null) return;
    const items = editing.items.map((item) => ({ ...item }));
    items[slot] = { ...items[slot], ...patch };
    setEditing({ ...editing, items });
  };

  const savedUse = savedId == null ? null : usage.get(savedId);

  return (
    <div className="mg-bars">
      <section className="mg-bars-list" aria-label="Saved bottom bars">
        <div className="mg-toolbar">
          <h2 className="mg-h2">Bottom bars</h2>
          <span className="mg-muted">
            {menus.length} saved · {ownCount} archive {ownCount === 1 ? 'screen keeps' : 'screens keep'} their own row
          </span>
          <span className="mg-grow" />
          <button
            type="button"
            className="mg-btn mg-btn-primary"
            onClick={() => {
              setError(null);
              setSavedId(null);
              setEditing(emptyMenuDraft());
            }}
          >
            + New bar
          </button>
        </div>

        {savedUse != null && savedId != null && (
          <div className="mg-banner" role="status">
            Saved. {savedUse.pages.size === 1 ? 'One page wears' : `${savedUse.pages.size} pages wear`} this bar
            with its old labels until re-published.
            <button
              type="button"
              className="mg-btn mg-btn-small"
              disabled={locked}
              onClick={() => {
                onReapply([...savedUse.pages].sort((a, b) => a - b), savedId);
                setSavedId(null);
              }}
            >
              Re-publish {describeRange([...savedUse.pages])}
            </button>
          </div>
        )}

        {menus.length === 0 ? (
          <p className="mg-empty">
            No saved bars yet. Make one, then pick it for pages in the Pages tab — one page at a time, or a whole
            selection at once.
          </p>
        ) : (
          <ul className="mg-bar-cards">
            {menus.map((menu) => {
              const use = usage.get(menu.id);
              return (
                <li key={menu.id} className={`mg-bar-card${editing?.id === menu.id ? ' mg-bar-card-on' : ''}`}>
                  <div className="mg-bar-card-head">
                    <strong>{menu.name}</strong>
                    <span className="mg-muted">
                      {use == null
                        ? 'Not used'
                        : `${use.pages.size} ${use.pages.size === 1 ? 'page' : 'pages'} · ${use.screens} ${use.screens === 1 ? 'screen' : 'screens'}`}
                    </span>
                  </div>
                  <MenuStrip items={menu.items} label={`${menu.name} preview`} />
                  <div className="mg-inline">
                    <button type="button" className="mg-btn mg-btn-small" onClick={() => edit(menu)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="mg-btn mg-btn-small mg-btn-ghost"
                      onClick={() => {
                        setError(null);
                        setEditing({ name: `${menu.name} copy`.slice(0, 40), items: menu.items.map((i) => ({ ...i })) });
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="mg-btn mg-btn-small mg-btn-danger-ghost"
                      onClick={() =>
                        confirm({
                          title: `Delete “${menu.name}”?`,
                          danger: true,
                          confirmLabel: 'Delete bar',
                          body: (
                            <p>
                              {use == null
                                ? 'No page uses it.'
                                : `${use.pages.size} ${use.pages.size === 1 ? 'page keeps' : 'pages keep'} the bar drawn on them, but will show “own row” here and lose it if re-published.`}
                            </p>
                          ),
                          onConfirm: () => {
                            void onDelete(menu.id).then((result) => {
                              if (!result.ok) setError(result.error);
                            });
                            if (editing?.id === menu.id) setEditing(null);
                          },
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mg-bars-editor" aria-label="Bar editor">
        {editing == null ? (
          <p className="mg-empty">Pick a bar to edit it, or make a new one.</p>
        ) : (
          <form
            className="mg-inspector"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h2 className="mg-h2">{editing.id == null ? 'New bar' : 'Edit bar'}</h2>
            <label className="mg-field">
              <span className="mg-label">Name</span>
              <input
                className="mg-input"
                value={editing.name}
                maxLength={40}
                placeholder="e.g. Main navigation"
                autoFocus
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>

            <div className="mg-slots">
              <span className="mg-label">Links, left to right</span>
              {MENU_COLORS.map((color, slot) => (
                <div key={color} className="mg-slot">
                  <span className={`mg-swatch mg-swatch-${color}`} aria-hidden />
                  <input
                    className="mg-input"
                    aria-label={`${color} label`}
                    maxLength={MAX_MENU_LABEL}
                    placeholder={color}
                    value={editing.items[slot]?.label ?? ''}
                    onChange={(event) => setSlot(slot, { label: event.target.value.toUpperCase() })}
                  />
                  <input
                    className="mg-input mg-input-num"
                    aria-label={`${color} page`}
                    inputMode="numeric"
                    placeholder="page"
                    value={editing.items[slot]?.pageNumber ?? ''}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
                      setSlot(slot, { pageNumber: digits === '' ? null : Number(digits) });
                    }}
                  />
                </div>
              ))}
              <p className="mg-note">Up to {MAX_MENU_LABEL} characters each — that is what fits in a quarter of the row.</p>
            </div>

            <div className="mg-field">
              <span className="mg-label">Preview</span>
              <MenuStrip items={editing.items} />
            </div>

            {error != null && (
              <p className="mg-note mg-note-bad" role="alert">
                {error}
              </p>
            )}

            <div className="mg-inline">
              <button type="submit" className="mg-btn mg-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editing.id == null ? 'Create bar' : 'Save changes'}
              </button>
              <button type="button" className="mg-btn mg-btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
