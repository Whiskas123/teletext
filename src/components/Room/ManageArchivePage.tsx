/**
 * ManageArchivePage — the `/manage` shell.
 *
 * Choosing what the site shows. The corpus holds ~3,150 captures across a few
 * hundred original page numbers, and there are only 600 slots (100..699) to put
 * them in, so this screen is about selection.
 *
 * It is two screens sharing a header, and it used to be one: a backup button,
 * capture filters, a capture browser, a publish panel, two rows of renumbering
 * tools and a grid of every page holding content, all stacked down a single
 * scroll. Now the corpus browser and the pages on air are tabs, and this module
 * is what they have in common.
 *
 * ## What the shell owns
 *
 * Which tab is selected, the notice line, the backup control, and the publication
 * records both tabs read. The action lifecycle is in `useManageActions`; each
 * panel's working state is in that panel's own state hook — *called* here, so it
 * survives the panel being unmounted while the other tab is shown.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useArchiveAdmin } from '../../collab/useArchiveAdmin';
import { useConnection } from '../../collab/useConnection';
import { useSnapshot } from '../../collab/useSnapshot';
import { usePageKinds } from '../../collab/usePageKinds';
import { useAdminStatus } from '../../collab/useIsModerator';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';
import type { TabKey } from '../../domain/manageTabs';
import { ManageTabBar } from './ManageTabBar';
import { NoticeArea } from './NoticeArea';
import { ConfirmDialog } from './ConfirmDialog';
import { OnAirPanel } from './OnAirPanel';
import { ArchivePanel } from './ArchivePanel';
import { useArchiveState } from './useArchiveState';
import { useManageActions } from './useManageActions';
import { useManageTab } from './useManageTab';
import { useOnAirState } from './useOnAirState';

const PANEL_ID = 'manage-panel';
const tabId = (tab: TabKey) => `manage-tab-${tab}`;

export function ManageArchivePage() {
  const { admin, loading: authLoading, configured } = useAdminStatus();
  const tab = useManageTab();
  const connection = useConnection();

  // Both panels' state hooks are called here, so an unmounted panel does not take
  // its filters, its selection or its open editor with it.
  const onAir = useOnAirState();
  const archive = useArchiveState();

  const data = useArchiveAdmin({
    admin,
    archiveEnabled: tab.archiveVisited,
    filters: archive.queryFilters,
    offset: archive.offset,
  });

  const snapshot = useSnapshot();
  const { kindOf, setKind } = usePageKinds();

  // Where focus lands when a confirmation's opening control went with the page it
  // deleted. The shell renders the notice, so the shell holds the ref.
  const noticeRef = useRef<HTMLDivElement>(null);

  const actions = useManageActions({
    data,
    setKind,
    onTextSaved: onAir.closeEditor,
    noticeRef,
  });

  const handlePublish = useCallback(() => {
    const capture = archive.selected;
    if (capture == null) return;

    actions.publish({
      pageNumber: Number(archive.draft.pageNumber),
      captureId: capture.id,
      title: archive.draft.title,
      description: archive.draft.description,
      transforms: {
        shiftDown: archive.draft.shiftDown,
        menuId: archive.draft.menuId,
      },
    });
  }, [actions, archive.selected, archive.draft]);

  const onAirCounts = useMemo(() => {
    // Null until the live document has synced. A confident "0 pages on air" while
    // playhtml is still connecting reads as an empty service.
    if (connection.status !== 'connected') return null;
    const curated = data.occupiedPages.filter(
      (pageNumber) => pageNumber < PLAYGROUND_MIN_PAGE,
    ).length;
    return { curated, playground: data.occupiedPages.length - curated };
  }, [connection.status, data.occupiedPages]);

  if (authLoading) {
    return (
      <div className="landing">
        <p className="landing-section-description">Checking sign-in…</p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="landing">
        <header className="landing-header">
          <h1 className="landing-title">MANAGE</h1>
        </header>
        <section className="landing-options">
          <p className="landing-section-description">
            {configured
              ? 'Sign in as moderator to manage the archive.'
              : 'This deployment has no admin password configured.'}
          </p>
          <Link to="/moderator" className="sidebar-action-btn">Go to sign-in</Link>
          <Link to="/" className="room-back-link">&lt; Back to home</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="manage">
      <header className="landing-header">
        <h1 className="landing-title">MANAGE ARCHIVE</h1>
        <p className="landing-section-description">
          {onAirCounts == null
            ? 'Reading the live pages…'
            : `${onAirCounts.curated + onAirCounts.playground} pages on air · ` +
              `${data.published.length} of them published from the archive`}
        </p>
      </header>

      {/* The tab bar and the notice share one sticky wrapper so they cannot
          overlap each other, and the notice stays in view while a long list
          scrolls under it. Both sit outside the panels and stay on either tab. */}
      <div className="manage-sticky">
        <ManageTabBar
          selected={tab.selected}
          onSelect={tab.select}
          onAirCounts={onAirCounts}
          captureTotal={tab.archiveVisited && !data.loading ? data.total : null}
          panelId={PANEL_ID}
          tabId={tabId}
        />
        <NoticeArea
          ref={noticeRef}
          notice={actions.notice}
          onDismiss={() => actions.setNotice(null)}
        />
      </div>

      <section className="manage-backup" aria-label="Backup">
        <button
          type="button"
          className="sidebar-action-btn"
          disabled={snapshot.saving || snapshot.pageCount === 0}
          onClick={() => void snapshot.snapshot()}
        >
          {snapshot.saving ? 'Backing up…' : 'Back up live pages now'}
        </button>
        {snapshot.lastResult != null && (
          <span className="manage-note">Backed up {snapshot.lastResult.stored} pages.</span>
        )}
        {snapshot.error != null && (
          <span className="manage-note manage-note-error">{snapshot.error}</span>
        )}
      </section>

      {/* One panel, the selected one. The other is not rendered at all, so it is
          absent from the accessibility tree rather than hidden inside it. */}
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab.selected)}>
        {tab.selected === 'on-air' ? (
          <OnAirPanel
            state={onAir}
            occupiedPages={data.occupiedPages}
            publicationsByPage={data.publishedByPage}
            publicationsError={data.publishedError}
            onRetryPublications={data.reloadPublished}
            inFlight={actions.inFlight}
            outcomes={actions.outcomes}
            titleOf={data.titleOf}
            descriptionOf={data.descriptionOf}
            kindOf={kindOf}
            livePage={data.livePage}
            onNudge={actions.nudge}
            onUnpublish={(pageNumber) =>
              actions.askConfirm({
                action: 'unpublish',
                pageNumber,
                title: data.titleOf(pageNumber),
              })
            }
            onDelete={(pageNumber, title) =>
              actions.askConfirm({ action: 'delete', pageNumber, title })
            }
            onSaveText={(pageNumber, draft) =>
              actions.saveText(pageNumber, draft.title, draft.description)
            }
            onSetRole={actions.setRole}
            onShift={data.shiftPages}
            onMove={data.moveBlock}
            onNotice={actions.setNotice}
          />
        ) : (
          <ArchivePanel
            state={archive}
            captures={data.captures}
            total={data.total}
            pageSize={data.pageSize}
            loading={data.loading}
            error={data.error}
            onRetry={data.retryCaptures}
            menus={data.menus}
            onSaveMenu={data.saveMenu}
            onDeleteMenu={data.deleteMenu}
            loadPage={data.loadPage}
            livePage={data.livePage}
            transform={data.transform}
            publicationsByPage={data.publishedByPage}
            publishBusy={actions.inFlight.publishBusy}
            onPublish={handlePublish}
          />
        )}
      </div>

      <Link to="/" className="room-back-link">&lt; Back to home</Link>

      {actions.confirming != null && (
        <ConfirmDialog
          request={actions.confirming}
          onConfirm={actions.confirmAction}
          onCancel={actions.closeConfirm}
        />
      )}
    </div>
  );
}

export default ManageArchivePage;
