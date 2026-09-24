/**
 * ManageArchivePage — the `/manage` route: sign-in gate, then the workspace
 * wired to the real data layer.
 *
 * The workspace itself takes everything as props (see `ManageWorkspace`); this
 * is the one place that calls the live hooks. The archive query sits here
 * rather than in the workspace because the data hook needs it: the corpus is
 * only fetched once the archive pane has been opened.
 */

import { Link } from 'react-router-dom';

import { useArchiveAdmin } from '../../collab/useArchiveAdmin';
import { useConnection } from '../../collab/useConnection';
import { useAdminStatus } from '../../collab/useIsModerator';
import { usePageKinds } from '../../collab/usePageKinds';
import { useShowcase } from '../../collab/useShowcase';
import { useMirrorStatus } from '../../collab/liveMirror';
import { ManageWorkspace } from './ManageWorkspace';
import { useArchiveQuery } from './useArchiveQuery';
import { useManageTab } from './useManageTab';

export function ManageArchivePage() {
  const { admin, loading, configured } = useAdminStatus();

  if (loading) {
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
          <Link to="/moderator" className="sidebar-action-btn">
            Go to sign-in
          </Link>
          <Link to="/" className="room-back-link">
            &lt; Back to home
          </Link>
        </section>
      </div>
    );
  }

  return <ConnectedWorkspace />;
}

function ConnectedWorkspace() {
  const tab = useManageTab();
  const query = useArchiveQuery(tab.initialArchive);
  const connection = useConnection();

  const data = useArchiveAdmin({
    admin: true,
    archiveEnabled: query.visited,
    filters: query.queryFilters,
    offset: query.offset,
  });
  // Fresh, not from the edge: this is the screen that changes the strip, and it
  // has to show what the database holds rather than what the CDN was handed.
  const showcase = useShowcase({ fresh: true });
  const mirror = useMirrorStatus();
  const { kindOf, setKind } = usePageKinds();

  return (
    <ManageWorkspace
      tab={tab}
      query={query}
      deps={{
        data,
        showcase,
        kindOf,
        setKind,
        mirror,
        connected: connection.status === 'connected',
      }}
    />
  );
}

export default ManageArchivePage;
