/**
 * The `/manage` workspace: a header, three tabs, and the one notice line.
 *
 * Everything it reads comes in through {@link ManageDeps} rather than from the
 * hooks directly. `ManageArchivePage` wires the real ones — playhtml, the API —
 * and the tests wire an in-memory stand-in, so the whole screen can be driven
 * without a network or a live document.
 */

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

import type { ArchiveAdminApi } from '../../collab/useArchiveAdmin';
import type { ShowcaseApi } from '../../collab/useShowcase';
import { LIVE_HOST, type MirrorApi } from '../../collab/liveMirror';
import type { PageKind } from '../../domain/directory';
import { TAB_KEYS, tabForKey, type TabKey, type TabNavKey } from '../../domain/manageTabs';
import { BarsTab } from './BarsTab';
import { ConfirmDialog, type ConfirmSpec } from './Dialog';
import { FrontPageTab } from './FrontPageTab';
import { PagesTab } from './PagesTab';
import type { ArchiveQuery } from './useArchiveQuery';
import { useManageActions } from './useManageActions';
import type { ManageTabApi } from './useManageTab';

import './manage.css';

export interface ManageDeps {
  data: ArchiveAdminApi;
  showcase: ShowcaseApi;
  kindOf(pageNumber: number): PageKind;
  setKind(pageNumber: number, kind: PageKind): void;
  /** The live mirror keeping the database's copy of the pages current. */
  mirror: MirrorApi;
  /** Whether the live document has synced. */
  connected: boolean;
}

export interface ManageWorkspaceProps {
  deps: ManageDeps;
  tab: ManageTabApi;
  query: ArchiveQuery;
}

const TAB_NAMES: Record<TabKey, string> = {
  pages: 'Pages',
  front: 'Front page',
  bars: 'Bottom bars',
};

const NAV_KEYS: readonly string[] = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

export function ManageWorkspace({ deps, tab, query }: ManageWorkspaceProps) {
  const { data, showcase, kindOf, setKind, mirror, connected } = deps;
  const actions = useManageActions({ data, showcase, setKind });
  const [confirming, setConfirming] = useState<ConfirmSpec | null>(null);
  const tabRefs = useRef(new Map<TabKey, HTMLButtonElement | null>());

  const onTabKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!NAV_KEYS.includes(event.key)) return;
      event.preventDefault();
      const next = tabForKey(tab.selected, event.key as TabNavKey);
      tab.select(next);
      tabRefs.current.get(next)?.focus();
    },
    [tab],
  );

  const counts: Record<TabKey, string | null> = {
    pages: connected ? String(data.occupiedPages.length) : null,
    front: showcase.loading ? null : String(showcase.entries.length),
    bars: String(data.menus.length),
  };

  const notice = actions.notice;
  const progress = actions.progress;

  return (
    <div className="mg">
      <header className="mg-header">
        <Link to="/" className="mg-wordmark" aria-label="Back to the site">
          MANAGE
        </Link>
        <nav className="mg-tabs" role="tablist" aria-label="Manage">
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              ref={(node) => {
                tabRefs.current.set(key, node);
              }}
              type="button"
              role="tab"
              id={`mg-tab-${key}`}
              aria-selected={tab.selected === key}
              aria-controls={tab.selected === key ? 'mg-panel' : undefined}
              tabIndex={tab.selected === key ? 0 : -1}
              className={`mg-tab${tab.selected === key ? ' mg-tab-on' : ''}`}
              onClick={() => tab.select(key)}
              onKeyDown={onTabKey}
            >
              {TAB_NAMES[key]}
              {counts[key] != null && <span className="mg-tab-count">{counts[key]}</span>}
            </button>
          ))}
        </nav>
        <span className="mg-grow" />
        <span className={`mg-live${connected ? ' mg-live-on' : ''}`} role="status">
          {connected ? 'Live' : 'Connecting…'}
        </span>
        <MirrorBadge mirror={mirror} onConfirmHeld={() => setConfirming({
          title: `Remove ${mirror.held.length} pages from the backup?`,
          danger: true,
          confirmLabel: `Remove ${mirror.held.length} from the backup`,
          body: (
            <p>
              These pages are no longer on the live service, but so many disappearing at once looks more like a
              loading problem than an edit, so the backup kept them: {mirror.held.slice(0, 20).join(', ')}
              {mirror.held.length > 20 ? '…' : ''}. Remove them only if you deleted them.
            </p>
          ),
          onConfirm: mirror.confirmHeld,
        })} />
      </header>

      {mirror.phase === 'wrong-host' && (
        <div className="mg-banner mg-host-banner" role="alert">
          This is <strong>{mirror.host}</strong>, not {LIVE_HOST}. Each address has its own live pages but they all
          share one database: anything published here is recorded for the live site too, but only appears on this
          address. The backup is not kept current from here.
        </div>
      )}

      <main id="mg-panel" className="mg-main" role="tabpanel" aria-labelledby={`mg-tab-${tab.selected}`}>
        {tab.selected === 'pages' ? (
          <PagesTab
            data={data}
            actions={actions}
            kindOf={kindOf}
            isShowcased={showcase.has}
            query={query}
            connected={connected}
            confirm={setConfirming}
          />
        ) : tab.selected === 'front' ? (
          <FrontPageTab
            showcase={showcase}
            occupiedPages={data.occupiedPages}
            titleOf={data.titleOf}
            subpageCountOfPage={data.subpageCountOfPage}
            onNotice={actions.setNotice}
          />
        ) : (
          <BarsTab
            menus={data.menus}
            published={data.published}
            locked={actions.structuralBusy}
            onSave={data.saveMenu}
            onDelete={data.deleteMenu}
            onReapply={(pages, menuId) => void actions.applyTransforms(pages, { shiftDown: null, menuId })}
            confirm={setConfirming}
          />
        )}
      </main>

      {/*
        * Both live regions are always present and only the matching one is
        * filled: a region inserted with its text is not reliably announced.
        * A failure interrupts; a success does not. Nothing leaves on a timer —
        * a message that vanished while someone looked away implies the screen
        * already told them.
        */}
      <div
        className={`mg-toast${notice != null || progress != null ? ' mg-toast-on' : ''}${
          notice?.tone === 'alert' && progress == null ? ' mg-toast-alert' : ''
        }`}
      >
        {progress != null ? (
          <div className="mg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={progress.label}>
            <span>
              {progress.label}
              {progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'}
            </span>
            <span className="mg-progress-track">
              <span
                className="mg-progress-fill"
                style={{ width: `${progress.total > 0 ? Math.max(8, (progress.done / progress.total) * 100) : 8}%` }}
              />
            </span>
          </div>
        ) : null}
        <p className="mg-toast-text" role="status">
          {progress == null && notice?.tone === 'status' ? notice.text : ''}
        </p>
        <p className="mg-toast-text" role="alert">
          {progress == null && notice?.tone === 'alert' ? notice.text : ''}
        </p>
        {notice != null && progress == null && (
          <button
            type="button"
            className="mg-icon-btn"
            aria-label="Dismiss message"
            onClick={() => actions.setNotice(null)}
          >
            ×
          </button>
        )}
      </div>

      {confirming != null && <ConfirmDialog spec={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

/**
 * Where the database's copy of the pages stands, in the header. Replaces the
 * "Back up now" button: the copy follows the live pages by itself now, and the
 * button is for checking again rather than for remembering to save.
 */
function MirrorBadge({ mirror, onConfirmHeld }: { mirror: MirrorApi; onConfirmHeld(): void }) {
  const time = (at: number | null) =>
    at == null ? '' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const [tone, label, title] =
    mirror.phase === 'synced'
      ? ['ok', `Backed up ${time(mirror.lastSynced)}`, 'The database copy matches the live pages. Click to check again.']
      : mirror.phase === 'saving'
        ? ['busy', mirror.pending > 0 ? `Backing up ${mirror.pending}…` : 'Backing up…', 'Saving the latest changes to the database copy.']
        : mirror.phase === 'waiting'
          ? ['busy', 'Loading pages…', 'The backup starts once the live pages have loaded.']
          : mirror.phase === 'error'
            ? ['bad', 'Backup behind', `${mirror.error ?? 'The backup could not be reached.'} Click to retry.`]
            : mirror.phase === 'wrong-host'
              ? ['warn', 'Not backing up', `Only ${LIVE_HOST} keeps the backup current.`]
              : ['warn', 'Backup off', 'The backup runs in a signed-in moderator’s browser.'];

  // The daily read copies the playground when no moderator is online. It leans
  // on playhtml internals, so a failure — or a run that has stopped happening —
  // is said out loud rather than left to a backup going quietly stale.
  const daily = mirror.daily;
  const dailyWarning =
    daily == null
      ? null
      : !daily.ok
        ? { label: 'Daily read failed', title: daily.detail ?? 'The daily read of the live pages failed.' }
        : daily.stale
          ? {
              label: 'Daily read stopped',
              title: `The last daily read of the live pages was ${new Date(daily.ranAt).toLocaleString()}.`,
            }
          : null;

  return (
    <span className="mg-mirror">
      {dailyWarning != null && (
        <span className="mg-mirror-badge mg-mirror-bad" title={dailyWarning.title} role="status">
          {dailyWarning.label}
        </span>
      )}
      {mirror.held.length > 0 && (
        <button type="button" className="mg-btn mg-btn-small mg-btn-warn" onClick={onConfirmHeld}>
          {mirror.held.length} removals waiting
        </button>
      )}
      <button
        type="button"
        className={`mg-mirror-badge mg-mirror-${tone}`}
        title={title}
        disabled={mirror.phase === 'wrong-host' || mirror.phase === 'off'}
        onClick={mirror.resync}
      >
        {label}
      </button>
    </span>
  );
}
