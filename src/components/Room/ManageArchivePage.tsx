/**
 * ManageArchivePage — the `/manage` screen.
 *
 * Choosing what the site shows. The corpus holds ~3,150 captures across a few
 * hundred original page numbers, and there are only 600 slots (100..699) to put
 * them in, so this screen is about selection.
 *
 * Page numbers were reused for unrelated content over the years, so the
 * captures sharing a number are usually different pages rather than versions of
 * one — which is why the browser is organised by **topic** (the on-disk folder
 * division) and era, and why every capture shows its actual render rather than
 * a summary of it: choosing between four captures of page 220 means reading
 * what is on them.
 *
 * ## Three previews, because publishing replaces something
 *
 * The screen shows the capture as it will be published (transforms applied),
 * and beside it whatever is on the target page right now, read from the live
 * document rather than the database so it includes any collaborative edits.
 * Publishing is destructive to that page, so it is worth seeing what goes.
 *
 * Previews are scaled to fit their column rather than cropped: a teletext page
 * is 40 cells wide and only means anything whole.
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
import { lastRowHasContent } from '../../domain/pageTransform';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';
import { createEmptyPage, type TeletextPage } from '../../types/teletext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import { CaptureImage } from '../TeletextGrid/CaptureImage';
import { MenuEditor } from './MenuEditor';

/** Topic folders, as the corpus is filed. */
const TOPIC_GROUPS = [
  'noticias', 'desporto', 'televisao', 'cultura', 'economia', 'meteorologia',
  'utilidades', 'horoscopo', 'publicidade', 'servicos-sms', 'indice',
  'passatempos', 'jogos-sorte', 'diario-republica', 'classificados', 'eventos',
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
    return `No render profile for ${capture.width}x${capture.height}`;
  }
  if (capture.decode_status === 'failed') return 'Failed to decode';
  return null;
}

export function ManageArchivePage() {
  const { admin, loading: authLoading, configured } = useAdminStatus();
  const admin_ = useArchiveAdmin();
  const {
    captures, total, published, menus, loading, error,
    search, loadPage, livePage, transform, publish, unpublish, saveMenu, deleteMenu,
  } = admin_;
  const snapshot = useSnapshot();

  const [filters, setFilters] = useState<CaptureFilters>({});
  const [selected, setSelected] = useState<CaptureSummary | null>(null);
  const [sourcePage, setSourcePage] = useState<TeletextPage | null>(null);
  const [pageNumber, setPageNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // On by default: most captures carry a menu strip on their bottom row that
  // the published page replaces anyway, so shifting is the common case and
  // leaving it off meant remembering to tick it every time.
  const [shiftDown, setShiftDown] = useState(true);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    search(filters);
  }, [filters, search]);

  const takenPages = useMemo(
    () => new Map(published.map((entry) => [entry.page_number, entry])),
    [published],
  );

  const choose = useCallback(
    async (capture: CaptureSummary) => {
      setSelected(capture);
      setNotice(null);
      setSourcePage(null);
      setTitle(capture.manifest_title?.slice(0, MAX_TITLE_LENGTH) ?? '');
      setDescription('');
      setPageNumber(String(capture.original_page));
      setShiftDown(true);
      setMenuId(null);
      setSourcePage(await loadPage(capture.id));
    },
    [loadPage],
  );

  /** The capture with the publish-time transforms applied — what will land. */
  const outgoing = useMemo(
    () => (sourcePage == null ? null : transform(sourcePage, { shiftDown, menuId })),
    [sourcePage, shiftDown, menuId, transform],
  );

  const target = Number(pageNumber);
  const current = Number.isInteger(target) ? livePage(target) : null;
  const targetTaken = takenPages.get(target);

  const handlePublish = useCallback(async () => {
    if (selected == null) return;
    setBusy(true);
    setNotice(null);
    const result = await publish({
      pageNumber: Number(pageNumber),
      captureId: selected.id,
      title,
      description,
      transforms: { shiftDown, menuId },
    });
    setBusy(false);
    setNotice(result.ok ? `Published to page ${pageNumber}.` : result.error);
  }, [selected, pageNumber, title, description, shiftDown, menuId, publish]);

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
          <Link to="/moderator" className="sidebar-action-btn">Go to sign-in</Link>
          <Link to="/" className="room-back-link">&lt; Back to home</Link>
        </section>
      </div>
    );
  }

  const blocked = selected == null ? null : blockedReason(selected);
  const wouldLoseRow = sourcePage != null && shiftDown && lastRowHasContent(sourcePage);

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
          <span className="manage-note">Backed up {snapshot.lastResult.stored} pages.</span>
        )}
        {snapshot.error != null && (
          <span className="manage-note manage-note-error">{snapshot.error}</span>
        )}
      </section>

      <section className="manage-filters" aria-label="Filters">
        <label className="sidebar-field-label" htmlFor="manage-topic">Topic</label>
        <select
          id="manage-topic"
          value={filters.topicGroup ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, topicGroup: e.target.value || undefined }))}
        >
          <option value="">All topics</option>
          {TOPIC_GROUPS.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
        </select>

        <label className="sidebar-field-label" htmlFor="manage-source">Source</label>
        <select
          id="manage-source"
          value={filters.source ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value || undefined }))}
        >
          <option value="">RTP and SIC</option>
          <option value="rtp">RTP</option>
          <option value="sic">SIC</option>
        </select>

        <label className="sidebar-field-label" htmlFor="manage-scheme">Era</label>
        <select
          id="manage-scheme"
          value={filters.scheme ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, scheme: e.target.value || undefined }))}
        >
          <option value="">All years</option>
          {SCHEMES.map((scheme) => <option key={scheme} value={scheme}>{scheme}</option>)}
        </select>

        <label className="sidebar-field-label" htmlFor="manage-page">Original page</label>
        <input
          id="manage-page"
          type="number"
          min={100}
          max={999}
          value={filters.page ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, page: e.target.value ? Number(e.target.value) : undefined }))
          }
        />

        <label className="manage-checkbox">
          <input
            type="checkbox"
            checked={filters.undecoded ?? false}
            onChange={(e) => setFilters((f) => ({ ...f, undecoded: e.target.checked || undefined }))}
          />
          Include captures that cannot be decoded
        </label>
      </section>

      {error != null && <p className="room-entry-error" role="alert">{error}</p>}

      <div className="manage-body">
        <section className="manage-results" aria-label="Captures">
          {loading ? (
            <p className="landing-section-description">Loading…</p>
          ) : captures.length === 0 ? (
            <p className="landing-section-description">Nothing matches those filters.</p>
          ) : (
            <ul className="manage-capture-grid">
              {captures.map((capture) => {
                const reason = blockedReason(capture);
                return (
                  <li key={capture.id}>
                    <button
                      type="button"
                      className={`manage-capture${selected?.id === capture.id ? ' manage-capture-selected' : ''}`}
                      onClick={() => void choose(capture)}
                    >
                      <CaptureImage
                        captureId={capture.id}
                        hasImage={capture.has_image}
                        label={`${capture.source.toUpperCase()} page ${capture.original_page}`}
                      />
                      <span className="manage-capture-meta">
                        <strong>
                          {capture.source.toUpperCase()} {capture.original_page}
                          {capture.sub ? `-${capture.sub}` : ''}
                        </strong>
                        <span>{capture.topic ?? 'unfiled'}</span>
                        <span>{describeSpan(capture)}</span>
                        {capture.capture_count > 1 && <span>seen {capture.capture_count} days</span>}
                        {reason != null && <span className="manage-note-error">{reason}</span>}
                        {capture.snapped_pixels > 0 && (
                          <span className="manage-note-error">{capture.snapped_pixels} suspect px</span>
                        )}
                      </span>
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
              <div className="manage-compare">
                <div>
                  <h3 className="manage-compare-title">
                    Will be published to {Number.isInteger(target) ? target : '—'}
                  </h3>
                  <div className="manage-preview">
                    <TeletextGrid page={outgoing ?? createEmptyPage()} readOnly />
                  </div>
                </div>
                <div>
                  <h3 className="manage-compare-title">
                    {current == null ? 'That page is empty' : 'That page shows now'}
                  </h3>
                  <div className={`manage-preview${current == null ? ' manage-preview-empty' : ''}`}>
                    <TeletextGrid page={current ?? createEmptyPage()} readOnly />
                  </div>
                  {targetTaken != null && (
                    <p className="manage-note">
                      Published {targetTaken.published_at.slice(0, 10)} from{' '}
                      {targetTaken.source.toUpperCase()} {targetTaken.original_page}
                      {targetTaken.sub ? `-${targetTaken.sub}` : ''}
                      {targetTaken.title ? ` — “${targetTaken.title}”` : ''}
                    </p>
                  )}
                  {current != null && targetTaken == null && (
                    // Content with no publication record is someone's own work,
                    // not something re-publishable from the corpus.
                    <p className="manage-note manage-note-error">
                      Not published from the archive — this page was edited by hand.
                    </p>
                  )}
                </div>
              </div>

              {blocked != null && (
                <p className="room-entry-error" role="status">
                  {blocked} — catalogued, but not publishable until its render profile exists.
                </p>
              )}

              <label className="manage-checkbox">
                <input
                  type="checkbox"
                  checked={shiftDown}
                  onChange={(e) => setShiftDown(e.target.checked)}
                />
                Shift down one row (drops the last row)
              </label>
              {wouldLoseRow && (
                <p className="manage-note">
                  The last row has content and will be discarded — which is the point when
                  it is a duplicate menu strip, but worth a look first.
                </p>
              )}

              <MenuEditor
                menus={menus}
                selectedId={menuId}
                onSelect={setMenuId}
                onSave={saveMenu}
                onDelete={deleteMenu}
              />

              <label className="sidebar-field-label" htmlFor="manage-target">Publish to page</label>
              <input
                id="manage-target"
                type="number"
                min={100}
                max={699}
                className="landing-name-input"
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
              />

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
                rows={3}
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
                {busy ? 'Publishing…' : current == null ? 'Publish' : 'Replace what is there'}
              </button>

              {notice != null && <p className="manage-note" role="status">{notice}</p>}
            </>
          )}
        </section>
      </div>

      <section className="manage-published" aria-label="Published pages">
        <h2 className="landing-section-title">Published</h2>
        {published.length === 0 ? (
          <p className="landing-section-description">Nothing published yet.</p>
        ) : (
          <ul className="manage-published-grid">
            {published.map((entry) => (
              <li key={entry.page_number} className="manage-published-card">
                <CaptureImage
                  captureId={entry.capture_id}
                  label={`Page ${entry.page_number}`}
                />
                <div className="manage-published-meta">
                  <strong>{entry.page_number}</strong>
                  <span>{entry.title || <em>untitled</em>}</span>
                  <span>
                    {entry.source.toUpperCase()} {entry.original_page}
                    {entry.topic != null && ` · ${entry.topic}`}
                  </span>
                  {(entry.shift_down || entry.menu_name != null) && (
                    <span className="manage-note">
                      {entry.shift_down ? 'shifted' : ''}
                      {entry.shift_down && entry.menu_name != null ? ' · ' : ''}
                      {entry.menu_name != null ? `menu: ${entry.menu_name}` : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    className="manage-mini-btn"
                    disabled={busy}
                    onClick={() => void handleUnpublish(entry.page_number)}
                  >
                    Unpublish
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link to="/" className="room-back-link">&lt; Back to home</Link>
    </div>
  );
}

export default ManageArchivePage;
