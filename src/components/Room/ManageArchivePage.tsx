/**
 * ManageArchivePage — the `/manage` screen.
 *
 * Choosing what the site shows. The corpus holds several thousand captures
 * across a few hundred original page numbers, and only 600 slots (100..699) to
 * put them in, so this screen is about selection: browse by topic, look at a
 * capture, give it a page number, a title and a description, publish.
 *
 * Page numbers were reused for unrelated content over the years, so the
 * captures sharing a number are usually different pages rather than versions of
 * one — which is why the browser is organised by **topic** (the on-disk folder
 * division) and era, not by page number alone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  useArchiveAdmin,
  type CaptureFilters,
  type CaptureSummary,
} from '../../collab/useArchiveAdmin';
import { useSnapshot } from '../../collab/useSnapshot';
import { useAdminStatus } from '../../collab/useIsModerator';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';
import { createEmptyPage, type TeletextPage } from '../../types/teletext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';

/** Topic folders, grouped the way the corpus is filed. */
const TOPIC_GROUPS = [
  'noticias',
  'desporto',
  'televisao',
  'cultura',
  'economia',
  'meteorologia',
  'utilidades',
  'horoscopo',
  'publicidade',
  'servicos-sms',
  'indice',
  'passatempos',
  'jogos-sorte',
  'diario-republica',
  'classificados',
  'eventos',
] as const;

const SCHEMES = ['1998-2000', '2001-2005', '2006-2010'] as const;

/** A short, human description of when a capture was on air. */
function describeSpan(capture: CaptureSummary): string {
  const first = capture.first_seen?.slice(0, 10);
  const last = capture.last_seen?.slice(0, 10);
  if (first == null) return 'undated';
  if (last == null || last === first) return first;
  return `${first} → ${last}`;
}

/** Why a capture cannot be published, or null when it can. */
function blockedReason(capture: CaptureSummary): string | null {
  if (capture.decode_status === 'unsupported-profile') {
    return `No render profile for ${capture.width}x${capture.height} yet`;
  }
  if (capture.decode_status === 'failed') return 'Failed to decode';
  return null;
}

export function ManageArchivePage() {
  const { admin, loading: authLoading, configured } = useAdminStatus();
  const {
    captures,
    total,
    published,
    loading,
    error,
    search,
    loadPage,
    publish,
    unpublish,
  } = useArchiveAdmin();
  const snapshot = useSnapshot();

  const [filters, setFilters] = useState<CaptureFilters>({});
  const [selected, setSelected] = useState<CaptureSummary | null>(null);
  const [preview, setPreview] = useState<TeletextPage | null>(null);
  const [pageNumber, setPageNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-query whenever a filter changes.
  useEffect(() => {
    search(filters);
  }, [filters, search]);

  /** Which page numbers are already taken, so the form can warn before publish. */
  const takenPages = useMemo(
    () => new Map(published.map((entry) => [entry.page_number, entry])),
    [published],
  );

  const choose = useCallback(
    async (capture: CaptureSummary) => {
      setSelected(capture);
      setNotice(null);
      setPreview(null);
      // Seed the title from the manifest when there is one — RTP records the
      // page's own header line, which is usually the title worth keeping.
      setTitle(capture.manifest_title?.slice(0, MAX_TITLE_LENGTH) ?? '');
      setDescription('');
      setPageNumber(String(capture.original_page));
      setPreview(await loadPage(capture.id));
    },
    [loadPage],
  );

  const handlePublish = useCallback(async () => {
    if (selected == null) return;
    setBusy(true);
    setNotice(null);
    const result = await publish({
      pageNumber: Number(pageNumber),
      captureId: selected.id,
      title,
      description,
    });
    setBusy(false);
    setNotice(
      result.ok ? `Published to page ${pageNumber}.` : result.error,
    );
  }, [selected, pageNumber, title, description, publish]);

  const handleUnpublish = useCallback(
    async (page: number) => {
      setBusy(true);
      const result = await unpublish(page);
      setBusy(false);
      setNotice(result.ok ? `Page ${page} unpublished.` : result.error);
    },
    [unpublish],
  );

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

  const targetTaken = takenPages.get(Number(pageNumber));
  const blocked = selected == null ? null : blockedReason(selected);

  return (
    <div className="manage">
      <header className="landing-header">
        <h1 className="landing-title">MANAGE ARCHIVE</h1>
        <p className="landing-section-description">
          {total} captures match · {published.length} pages published
        </p>
      </header>

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
          <span className="manage-note">
            Backed up {snapshot.lastResult.stored} pages.
          </span>
        )}
        {snapshot.error != null && (
          <span className="manage-note manage-note-error">{snapshot.error}</span>
        )}
      </section>

      <section className="manage-filters" aria-label="Filters">
        <label className="sidebar-field-label" htmlFor="manage-topic">
          Topic
        </label>
        <select
          id="manage-topic"
          value={filters.topicGroup ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, topicGroup: e.target.value || undefined }))
          }
        >
          <option value="">All topics</option>
          {TOPIC_GROUPS.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>

        <label className="sidebar-field-label" htmlFor="manage-source">
          Source
        </label>
        <select
          id="manage-source"
          value={filters.source ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, source: e.target.value || undefined }))
          }
        >
          <option value="">RTP and SIC</option>
          <option value="rtp">RTP</option>
          <option value="sic">SIC</option>
        </select>

        <label className="sidebar-field-label" htmlFor="manage-scheme">
          Era
        </label>
        <select
          id="manage-scheme"
          value={filters.scheme ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, scheme: e.target.value || undefined }))
          }
        >
          <option value="">All years</option>
          {SCHEMES.map((scheme) => (
            <option key={scheme} value={scheme}>
              {scheme}
            </option>
          ))}
        </select>

        <label className="sidebar-field-label" htmlFor="manage-page">
          Original page
        </label>
        <input
          id="manage-page"
          type="number"
          min={100}
          max={999}
          value={filters.page ?? ''}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              page: e.target.value ? Number(e.target.value) : undefined,
            }))
          }
        />

        <label className="manage-checkbox">
          <input
            type="checkbox"
            checked={filters.undecoded ?? false}
            onChange={(e) =>
              setFilters((f) => ({ ...f, undecoded: e.target.checked || undefined }))
            }
          />
          Include captures that cannot be decoded yet
        </label>
      </section>

      {error != null && (
        <p className="room-entry-error" role="alert">
          {error}
        </p>
      )}

      <div className="manage-body">
        <section className="manage-results" aria-label="Captures">
          {loading ? (
            <p className="landing-section-description">Loading…</p>
          ) : captures.length === 0 ? (
            <p className="landing-section-description">
              Nothing matches those filters.
            </p>
          ) : (
            <ul className="manage-capture-list">
              {captures.map((capture) => {
                const reason = blockedReason(capture);
                return (
                  <li key={capture.id}>
                    <button
                      type="button"
                      className={`manage-capture${
                        selected?.id === capture.id ? ' manage-capture-selected' : ''
                      }`}
                      onClick={() => void choose(capture)}
                    >
                      <strong>
                        {capture.source.toUpperCase()} {capture.original_page}
                        {capture.sub ? `-${capture.sub}` : ''}
                      </strong>
                      <span>{capture.topic ?? 'unfiled'}</span>
                      <span>{describeSpan(capture)}</span>
                      {capture.capture_count > 1 && (
                        <span>seen {capture.capture_count} days</span>
                      )}
                      {capture.manifest_title != null && (
                        <span className="manage-capture-title">
                          {capture.manifest_title}
                        </span>
                      )}
                      {reason != null && (
                        <span className="manage-note-error">{reason}</span>
                      )}
                      {capture.snapped_pixels > 0 && (
                        <span className="manage-note-error">
                          {capture.snapped_pixels} suspect pixels
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="manage-detail" aria-label="Selected capture">
          {selected == null ? (
            <p className="landing-section-description">
              Pick a capture to preview and publish it.
            </p>
          ) : (
            <>
              <div className="manage-preview">
                <TeletextGrid page={preview ?? createEmptyPage()} />
              </div>

              {blocked != null && (
                <p className="room-entry-error" role="status">
                  {blocked} — this capture is catalogued but cannot be published
                  until its render profile and glyph atlas exist.
                </p>
              )}

              <label className="sidebar-field-label" htmlFor="manage-target">
                Publish to page
              </label>
              <input
                id="manage-target"
                type="number"
                min={100}
                max={699}
                className="landing-name-input"
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
              />
              {targetTaken != null && (
                <p className="manage-note" role="status">
                  Page {targetTaken.page_number} currently shows{' '}
                  {targetTaken.source.toUpperCase()} {targetTaken.original_page}
                  {targetTaken.sub ? `-${targetTaken.sub}` : ''}. Publishing
                  replaces it.
                </p>
              )}

              <label className="sidebar-field-label" htmlFor="manage-title">
                Title ({title.length}/{MAX_TITLE_LENGTH})
              </label>
              <input
                id="manage-title"
                className="landing-name-input"
                maxLength={MAX_TITLE_LENGTH}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <label className="sidebar-field-label" htmlFor="manage-description">
                Description ({description.length}/{MAX_DESCRIPTION_LENGTH})
              </label>
              <textarea
                id="manage-description"
                className="landing-name-input"
                rows={4}
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              <button
                type="button"
                className="sidebar-action-btn"
                disabled={busy || blocked != null}
                onClick={() => void handlePublish()}
              >
                {busy ? 'Publishing…' : 'Publish'}
              </button>

              {notice != null && (
                <p className="manage-note" role="status">
                  {notice}
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section className="manage-published" aria-label="Published pages">
        <h2 className="landing-section-title">Published</h2>
        {published.length === 0 ? (
          <p className="landing-section-description">Nothing published yet.</p>
        ) : (
          <table className="manage-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Shows</th>
                <th>Title</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {published.map((entry) => (
                <tr key={entry.page_number}>
                  <td>{entry.page_number}</td>
                  <td>
                    {entry.source.toUpperCase()} {entry.original_page}
                    {entry.sub ? `-${entry.sub}` : ''}
                    {entry.topic != null && ` · ${entry.topic}`}
                  </td>
                  <td>{entry.title || <em>untitled</em>}</td>
                  <td>{entry.published_at.slice(0, 10)}</td>
                  <td>
                    <button
                      type="button"
                      className="sidebar-action-btn"
                      disabled={busy}
                      onClick={() => void handleUnpublish(entry.page_number)}
                    >
                      Unpublish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Link to="/" className="room-back-link">
        &lt; Back to home
      </Link>
    </div>
  );
}

export default ManageArchivePage;
