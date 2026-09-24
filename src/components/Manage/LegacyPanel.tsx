/**
 * Moving the old publication table into the live pages, once.
 *
 * Which capture is on which screen used to be kept in the database, in a map
 * of its own; it now lives beside each screen in playhtml. This panel shows
 * while the old table still has records the live pages do not, split by what
 * can be done with them:
 *
 * - **on air** — the screen is there; its record moves in beside it. Each
 *   capture is rendered with its recorded transforms, so a screen edited by
 *   hand since shows as edited afterwards rather than passing for untouched.
 * - **empty** — the record points at a screen with nothing on it (cleared in
 *   the editor, or published from another address). Restore it from the
 *   archive, or set the record aside.
 *
 * Nothing here changes a page that is on air, except restoring an empty one.
 * Once both lists are empty the panel is gone for good.
 */

import { useState } from 'react';

import type { ArchiveAdminApi, PublishedEntry } from '../../collab/useArchiveAdmin';
import { describeSource } from '../../domain/pageSource';
import type { ConfirmSpec } from './Dialog';
import type { ManageActionsApi } from './useManageActions';

export interface LegacyPanelProps {
  data: Pick<ArchiveAdminApi, 'legacy'>;
  actions: Pick<ManageActionsApi, 'moveInLegacy' | 'restoreLegacy' | 'discardLegacy'>;
  locked: boolean;
  confirm(spec: ConfirmSpec): void;
}

const where = (record: PublishedEntry) =>
  (record.subpage ?? 1) > 1 ? `${record.page_number}/${record.subpage}` : String(record.page_number);

const label = (record: PublishedEntry) =>
  describeSource({ source: record.source, originalPage: record.original_page, sub: record.sub });

export function LegacyPanel({ data, actions, locked, confirm }: LegacyPanelProps) {
  const { adoptable, stranded, loading, error } = data.legacy;
  const [open, setOpen] = useState(false);

  if (loading) return null;
  if (error != null) {
    return (
      <div className="mg-banner" role="alert">
        Could not read the old publication records: {error}{' '}
        <button type="button" className="mg-btn mg-btn-small" onClick={data.legacy.reload}>
          Retry
        </button>
      </div>
    );
  }
  if (adoptable.length === 0 && stranded.length === 0) return null;

  return (
    <section className="mg-legacy" aria-label="Old publication records">
      <div className="mg-legacy-head">
        <strong>Old publication records</strong>
        <span className="mg-muted">
          Where each archive screen came from now lives with the page itself. These records are still in the old
          table.
        </span>
      </div>

      {adoptable.length > 0 && (
        <div className="mg-legacy-row">
          <span className="mg-grow">
            <strong>{adoptable.length}</strong> on air — ready to move in beside their pages. Nothing on air changes.
          </span>
          <button
            type="button"
            className="mg-btn mg-btn-small mg-btn-primary"
            disabled={locked}
            onClick={() => void actions.moveInLegacy(adoptable)}
          >
            Move {adoptable.length} in
          </button>
        </div>
      )}

      {stranded.length > 0 && (
        <div className="mg-legacy-row mg-legacy-stranded">
          <span className="mg-grow">
            <strong>{stranded.length}</strong> point at empty screens — cleared in the editor, or published from another
            address.{' '}
            <button type="button" className="mg-link" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? 'Hide' : 'Show them'}
            </button>
          </span>
          <button
            type="button"
            className="mg-btn mg-btn-small"
            disabled={locked}
            onClick={() => void actions.restoreLegacy(stranded)}
          >
            Restore all
          </button>
          <button
            type="button"
            className="mg-btn mg-btn-small mg-btn-danger-ghost"
            disabled={locked}
            onClick={() =>
              confirm({
                title: `Set ${stranded.length} old records aside?`,
                confirmLabel: 'Set aside',
                body: (
                  <p>
                    Their screens stay empty, and the records stop being offered here. They are kept in the old table as
                    history.
                  </p>
                ),
                onConfirm: () => void actions.discardLegacy(stranded),
              })
            }
          >
            Set all aside
          </button>
        </div>
      )}

      {open && stranded.length > 0 && (
        <ul className="mg-legacy-list">
          {stranded.map((record) => (
            <li key={`${record.page_number}.${record.subpage ?? 1}`}>
              <span className="mg-num">{where(record)}</span>
              <span className="mg-grow mg-ellipsis">
                {record.title || <em className="mg-muted">Untitled</em>}{' '}
                <span className="mg-muted">· {label(record)}</span>
              </span>
              <button
                type="button"
                className="mg-btn mg-btn-small"
                disabled={locked}
                onClick={() => void actions.restoreLegacy([record])}
              >
                Restore
              </button>
              <button
                type="button"
                className="mg-btn mg-btn-small mg-btn-ghost"
                disabled={locked}
                onClick={() => void actions.discardLegacy([record])}
              >
                Set aside
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
