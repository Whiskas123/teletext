/**
 * The inspector when several pages are selected: the properties they can share,
 * set on all of them at once.
 *
 * Each control shows the common value, or "Mixed" when the pages disagree —
 * and picking a value sets it on every page, the way a spreadsheet's format
 * bar does. Nothing about the pages that agree changes silently: a control
 * left alone changes nothing.
 */

import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import { describeRange } from '../../domain/lineup';
import type { CustomMenu } from '../../domain/menu';
import { KIND_NAMES, type PageRow } from './lineupModel';

export interface SelectionInspectorProps {
  rows: readonly PageRow[];
  menus: readonly CustomMenu[];
  locked: boolean;
  onSetRole(kind: PageKind): void;
  onSetBar(menuId: number | null): void;
  onSetShift(shift: boolean): void;
  onMove(): void;
  onMerge(): void;
  onDelete(): void;
  onClear(): void;
}

const MIXED = '__mixed';

function common<T>(values: readonly T[]): T | typeof MIXED {
  return values.every((value) => value === values[0]) ? values[0] : MIXED;
}

export function SelectionInspector({
  rows,
  menus,
  locked,
  onSetRole,
  onSetBar,
  onSetShift,
  onMove,
  onMerge,
  onDelete,
  onClear,
}: SelectionInspectorProps) {
  const pages = rows.map((row) => row.pageNumber);
  const archive = rows.filter((row) => row.archiveScreens > 0);
  const role = common(rows.map((row) => row.kind));
  const bar = common(
    archive.map((row) =>
      row.bar.kind === 'menu' ? String(row.bar.id) : row.bar.kind === 'own' ? 'own' : MIXED,
    ),
  );
  const shift = common(archive.map((row) => row.shift));
  const handMade = rows.length - archive.length;

  return (
    <aside className="mg-inspector" aria-label={`${rows.length} pages selected`}>
      <header className="mg-insp-head">
        <div>
          <div className="mg-insp-number">{rows.length} pages</div>
          <div className="mg-muted">{describeRange(pages)}</div>
        </div>
        <button type="button" className="mg-btn mg-btn-small mg-btn-ghost" onClick={onClear}>
          Clear selection
        </button>
      </header>

      <section className="mg-insp-section">
        <label className="mg-field">
          <span className="mg-label">Directory role</span>
          <select
            className="mg-input"
            value={role}
            disabled={locked}
            onChange={(event) => onSetRole(event.target.value as PageKind)}
          >
            {role === MIXED && (
              <option value={MIXED} disabled>
                Mixed
              </option>
            )}
            {PAGE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_NAMES[kind]}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="mg-insp-section" aria-label="Bottom bar">
        <h3 className="mg-h3">Bottom bar</h3>
        {archive.length === 0 ? (
          <p className="mg-note">None of these came from the archive, so their bottom rows are drawn by hand.</p>
        ) : (
          <>
            <label className="mg-field">
              <span className="mg-label">
                On {archive.length === rows.length ? 'all of them' : `the ${archive.length} archive pages`}
              </span>
              <select
                className="mg-input"
                value={bar}
                disabled={locked}
                onChange={(event) =>
                  onSetBar(event.target.value === 'own' ? null : Number(event.target.value))
                }
              >
                {bar === MIXED && (
                  <option value={MIXED} disabled>
                    Mixed
                  </option>
                )}
                <option value="own">The capture’s own row</option>
                {menus.map((menu) => (
                  <option key={menu.id} value={String(menu.id)}>
                    {menu.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mg-field">
              <span className="mg-label">Shift down one row</span>
              <select
                className="mg-input"
                value={shift === MIXED || shift === 'mixed' ? MIXED : shift ? 'on' : 'off'}
                disabled={locked}
                onChange={(event) => onSetShift(event.target.value === 'on')}
              >
                {(shift === MIXED || shift === 'mixed') && (
                  <option value={MIXED} disabled>
                    Mixed
                  </option>
                )}
                <option value="on">Shifted</option>
                <option value="off">Not shifted</option>
              </select>
            </label>
            {handMade > 0 && (
              <p className="mg-note">
                {handMade} hand-made {handMade === 1 ? 'page is' : 'pages are'} left as drawn.
              </p>
            )}
          </>
        )}
      </section>

      <section className="mg-insp-section">
        <div className="mg-stack">
          <button type="button" className="mg-btn" disabled={locked} onClick={onMove}>
            Move to…
          </button>
          <button type="button" className="mg-btn" disabled={locked} onClick={onMerge}>
            Merge into page {pages[0]} as screens…
          </button>
          <button type="button" className="mg-btn mg-btn-danger-ghost" disabled={locked} onClick={onDelete}>
            Delete {rows.length} pages…
          </button>
        </div>
      </section>
    </aside>
  );
}
