/**
 * The archive, beside the page list: find captures, pick several, put them on.
 *
 * Source on one side, destination on the other, the way a file manager copies
 * between two folders. Captures can be dragged straight into the list — between
 * two pages to add them there, onto a page to add them as its screens — or
 * picked here and sent with the form at the bottom, which says exactly what it
 * is about to do before it does it.
 *
 * Picking is ordered. Captures land in the order they were picked, which is
 * the whole interface for publishing a story across consecutive pages or
 * screens: pick them in reading order, add once.
 */

import { useEffect, useMemo, useState } from 'react';

import type { CaptureFilters, CaptureSummary, PublishTransforms } from '../../collab/useArchiveAdmin';
import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import { noCaptureMatch } from '../../domain/manageMessages';
import type { CustomMenu } from '../../domain/menu';
import type { TeletextPage } from '../../types/teletext';
import { CaptureImage } from '../TeletextGrid/CaptureImage';
import { MAX_CAPTURE_QUERY, blockedReason, describeSpan } from './captureMeta';
import { Dialog } from './Dialog';
import { beginDrag, endDrag } from './dnd';
import type { DropVerdict } from './LineupTable';
import { KIND_NAMES, type AddDestination, type AddSettings } from './lineupModel';
import { MenuStrip } from './MenuStrip';
import { PageThumb } from './PageThumb';
import type { ArchiveQuery } from './useArchiveQuery';

/** Topic folders, as the corpus is filed. */
const TOPIC_GROUPS = [
  'noticias', 'desporto', 'televisao', 'cultura', 'economia', 'meteorologia',
  'utilidades', 'horoscopo', 'publicidade', 'servicos-sms', 'indice',
  'passatempos', 'jogos-sorte', 'diario-republica', 'classificados', 'eventos',
] as const;

const SCHEMES = ['1998-2000', '2001-2005', '2006-2010'] as const;

export interface ArchivePaneProps {
  query: ArchiveQuery;
  captures: readonly CaptureSummary[];
  total: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  picked: readonly CaptureSummary[];
  setPicked(picked: CaptureSummary[]): void;
  destination: AddDestination;
  setDestination(destination: AddDestination): void;
  settings: AddSettings;
  setSettings(settings: AddSettings): void;
  menus: readonly CustomMenu[];
  checkAdd(): DropVerdict;
  onAdd(): void;
  /** Pick every screen of the story this capture belongs to. */
  onPickStory(capture: CaptureSummary): void;
  loadPage(captureId: number): Promise<TeletextPage | null>;
  transform(page: TeletextPage, transforms: PublishTransforms): TeletextPage;
  locked: boolean;
  onClose(): void;
}

const labelOf = (capture: CaptureSummary) =>
  `${capture.source.toUpperCase()} ${capture.original_page}${capture.sub ? `-${capture.sub}` : ''}`;

export function ArchivePane({
  query,
  captures,
  total,
  pageSize,
  loading,
  error,
  onRetry,
  picked,
  setPicked,
  destination,
  setDestination,
  settings,
  setSettings,
  menus,
  checkAdd,
  onAdd,
  onPickStory,
  loadPage,
  transform,
  locked,
  onClose,
}: ArchivePaneProps) {
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState<CaptureSummary | null>(null);
  const pickedIds = useMemo(() => picked.map((capture) => capture.id), [picked]);
  const { filters } = query;
  const change = (patch: Partial<CaptureFilters>) =>
    query.changeFilters((current) => ({ ...current, ...patch }));

  const togglePick = (capture: CaptureSummary, range: boolean) => {
    if (range && lastClicked != null) {
      const ids = captures.map((c) => c.id);
      const a = ids.indexOf(lastClicked);
      const b = ids.indexOf(capture.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const adding = captures.slice(lo, hi + 1).filter((c) => !pickedIds.includes(c.id));
        setPicked([...picked, ...adding]);
        setLastClicked(capture.id);
        return;
      }
    }
    setPicked(
      pickedIds.includes(capture.id)
        ? picked.filter((c) => c.id !== capture.id)
        : [...picked, capture],
    );
    setLastClicked(capture.id);
  };

  const verdict = picked.length > 0 ? checkAdd() : null;
  const count = picked.length;

  return (
    <aside className="mg-archive" aria-label="Archive">
      <header className="mg-archive-head">
        <h2 className="mg-h2">Archive</h2>
        <span className="mg-muted">
          {loading ? 'Searching…' : `${total.toLocaleString()} captures`}
        </span>
        <button type="button" className="mg-icon-btn" aria-label="Close the archive" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="mg-archive-filters" role="search">
        <input
          type="search"
          className="mg-input mg-grow"
          aria-label="Search titles and filenames"
          placeholder="Search titles and filenames"
          maxLength={MAX_CAPTURE_QUERY}
          value={filters.q ?? ''}
          onChange={(event) => change({ q: event.target.value || undefined })}
        />
        <select
          className="mg-input"
          aria-label="Topic"
          value={filters.topicGroup ?? ''}
          onChange={(event) => change({ topicGroup: event.target.value || undefined })}
        >
          <option value="">All topics</option>
          {TOPIC_GROUPS.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
        <select
          className="mg-input"
          aria-label="Source"
          value={filters.source ?? ''}
          onChange={(event) => change({ source: event.target.value || undefined })}
        >
          <option value="">RTP + SIC</option>
          <option value="rtp">RTP</option>
          <option value="sic">SIC</option>
        </select>
        <select
          className="mg-input"
          aria-label="Era"
          value={filters.scheme ?? ''}
          onChange={(event) => change({ scheme: event.target.value || undefined })}
        >
          <option value="">All years</option>
          {SCHEMES.map((scheme) => (
            <option key={scheme} value={scheme}>
              {scheme}
            </option>
          ))}
        </select>
        <input
          className="mg-input mg-input-num"
          aria-label="Original page"
          placeholder="Orig. p."
          inputMode="numeric"
          value={filters.page ?? ''}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
            change({ page: digits === '' ? undefined : Number(digits) });
          }}
        />
        <label className="mg-check mg-check-small">
          <input
            type="checkbox"
            checked={filters.undecoded ?? false}
            onChange={(event) => change({ undecoded: event.target.checked || undefined })}
          />
          Undecodable too
        </label>
      </div>

      <div className="mg-archive-view">
        <label className="mg-check mg-check-small">
          <input
            type="checkbox"
            checked={filters.unpublished ?? false}
            onChange={(event) => change({ unpublished: event.target.checked || undefined })}
          />
          Hide published
        </label>
        <label
          className="mg-check mg-check-small"
          title="One capture per page and screen: the most recent day. Other days of the same page stay one click away."
        >
          <input
            type="checkbox"
            checked={filters.latest ?? false}
            onChange={(event) => change({ latest: event.target.checked || undefined })}
          />
          One per page
        </label>
        <select
          className="mg-input mg-input-small"
          aria-label="Sort"
          value={filters.sort ?? 'page'}
          onChange={(event) =>
            change({ sort: event.target.value === 'page' ? undefined : (event.target.value as 'newest' | 'oldest') })
          }
        >
          <option value="page">By page number</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <div className="mg-archive-results">
        {error != null ? (
          <div className="mg-empty" role="alert">
            <p>{error}</p>
            <button type="button" className="mg-btn mg-btn-small" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : !loading && captures.length === 0 ? (
          <div className="mg-empty">
            <p>{noCaptureMatch(query.queryFilters)}</p>
            <button type="button" className="mg-btn mg-btn-small" onClick={query.clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <ul className={`mg-captures${loading ? ' mg-loading' : ''}`}>
            {captures.map((capture) => {
              const order = pickedIds.indexOf(capture.id);
              const blocked = blockedReason(capture);
              return (
                <li
                  key={capture.id}
                  className={`mg-capture${order !== -1 ? ' mg-capture-picked' : ''}${blocked ? ' mg-capture-blocked' : ''}`}
                  draggable={!locked && blocked == null}
                  onDragStart={(event) => {
                    // A picked capture carries the whole pick with it; an
                    // unpicked one goes on its own, as in a file manager.
                    const ids = order !== -1 ? pickedIds : [capture.id];
                    beginDrag(
                      event,
                      { kind: 'captures', ids },
                      ids.length === 1 ? labelOf(capture) : `${ids.length} captures`,
                    );
                  }}
                  onDragEnd={endDrag}
                >
                  <button
                    type="button"
                    className="mg-capture-pick"
                    aria-pressed={order !== -1}
                    aria-label={`${order !== -1 ? 'Unpick' : 'Pick'} ${labelOf(capture)}`}
                    onClick={(event) => togglePick(capture, event.shiftKey)}
                  >
                    <CaptureImage captureId={capture.id} hasImage={capture.has_image} label={labelOf(capture)} />
                    {order !== -1 && <span className="mg-capture-order">{order + 1}</span>}
                  </button>
                  <div className="mg-capture-meta">
                    <strong>{labelOf(capture)}</strong>
                    <button
                      type="button"
                      className="mg-icon-btn mg-icon-btn-small"
                      aria-label={`Preview ${labelOf(capture)}`}
                      title="Preview as it would be published"
                      onClick={() => setPreviewing(capture)}
                    >
                      ⤢
                    </button>
                    <span className="mg-muted mg-ellipsis">
                      {capture.manifest_title ?? capture.topic ?? 'unfiled'}
                    </span>
                    <span
                      className="mg-muted"
                      title="Last day the archive captured this page on air"
                    >
                      {describeSpan(capture)}
                    </span>
                    {blocked != null && <span className="mg-bad">{blocked}</span>}
                    {(capture.published_to?.length ?? 0) > 0 && (
                      <span className="mg-published" title={`Published on ${capture.published_to!.join(', ')}`}>
                        On {capture.published_to!.map((at) => at.replace(/\/1$/, '')).join(', ')}
                      </span>
                    )}
                    <span className="mg-capture-actions">
                      {(capture.story_size ?? 1) > 1 && (
                        <button
                          type="button"
                          className="mg-link"
                          title="Pick every screen of this page from the same day, in order"
                          onClick={() => onPickStory(capture)}
                        >
                          Whole story · {capture.story_size}
                        </button>
                      )}
                      {filters.latest && (capture.versions ?? 1) > 1 && (
                        <button
                          type="button"
                          className="mg-link"
                          title="Show every day this page was captured"
                          onClick={() =>
                            change({ page: capture.original_page, source: capture.source, latest: undefined })
                          }
                        >
                          +{(capture.versions ?? 1) - 1} other {(capture.versions ?? 1) - 1 === 1 ? 'day' : 'days'}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {total > pageSize && (
          <nav className="mg-pager" aria-label="Result pages">
            <button
              type="button"
              className="mg-btn mg-btn-small"
              disabled={query.offset === 0}
              onClick={() => query.setOffset(Math.max(0, query.offset - pageSize))}
            >
              ‹ Previous
            </button>
            <span className="mg-muted">
              {query.offset + 1}–{Math.min(query.offset + pageSize, total)} of {total.toLocaleString()}
            </span>
            <button
              type="button"
              className="mg-btn mg-btn-small"
              disabled={query.offset + pageSize >= total}
              onClick={() => query.setOffset(query.offset + pageSize)}
            >
              Next ›
            </button>
          </nav>
        )}
      </div>

      <footer className="mg-add">
        {count === 0 ? (
          <p className="mg-note">
            Pick captures to add them — in the order you want them — or drag them into the list: between two
            pages to add new pages there, onto a page to add them as its screens.
          </p>
        ) : (
          <>
            <div className="mg-add-picked">
              <strong>{count} picked</strong>
              <ol className="mg-chips">
                {picked.map((capture, index) => (
                  <li key={capture.id} className="mg-chip">
                    <span className="mg-muted">{index + 1}.</span> {labelOf(capture)}
                    <button
                      type="button"
                      className="mg-chip-x"
                      aria-label={`Unpick ${labelOf(capture)}`}
                      onClick={() => setPicked(picked.filter((c) => c.id !== capture.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="mg-btn mg-btn-small mg-btn-ghost" onClick={() => setPicked([])}>
                Clear
              </button>
            </div>

            <div className="mg-segmented" role="radiogroup" aria-label="Add as">
              {(
                [
                  ['pages', count === 1 ? 'New page' : 'New pages'],
                  ['story', 'One page, as screens'],
                  ['screens', 'Screens of a page'],
                  ['replace', 'Replace a screen'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={destination.mode === mode}
                  disabled={(mode === 'replace' && count !== 1) || (mode === 'story' && count < 2)}
                  title={
                    mode === 'replace' && count !== 1
                      ? 'Pick exactly one capture to replace a screen'
                      : mode === 'story' && count < 2
                        ? 'Pick two or more captures to make one page of them'
                        : undefined
                  }
                  className={`mg-seg${destination.mode === mode ? ' mg-seg-on' : ''}`}
                  onClick={() => {
                    if (mode === destination.mode) return;
                    const page =
                      destination.mode === 'pages' || destination.mode === 'story'
                        ? destination.at
                        : destination.page;
                    setDestination(
                      mode === 'pages' || mode === 'story'
                        ? { mode, at: page }
                        : mode === 'screens'
                          ? { mode, page }
                          : { mode, page, screen: '1' },
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mg-field-row">
              {destination.mode === 'pages' || destination.mode === 'story' ? (
                <label className="mg-field">
                  <span className="mg-label">{destination.mode === 'story' ? 'Page number' : 'Starting at'}</span>
                  <input
                    className="mg-input mg-input-num"
                    inputMode="numeric"
                    value={destination.at}
                    onChange={(event) =>
                      setDestination({ mode: destination.mode, at: event.target.value.replace(/\D/g, '').slice(0, 3) })
                    }
                  />
                </label>
              ) : (
                <label className="mg-field">
                  <span className="mg-label">Page</span>
                  <input
                    className="mg-input mg-input-num"
                    inputMode="numeric"
                    value={destination.page}
                    onChange={(event) =>
                      setDestination({ ...destination, page: event.target.value.replace(/\D/g, '').slice(0, 3) })
                    }
                  />
                </label>
              )}
              {destination.mode === 'replace' && (
                <label className="mg-field">
                  <span className="mg-label">Screen</span>
                  <input
                    className="mg-input mg-input-num"
                    inputMode="numeric"
                    value={destination.screen}
                    onChange={(event) =>
                      setDestination({ ...destination, screen: event.target.value.replace(/\D/g, '').slice(0, 2) })
                    }
                  />
                </label>
              )}
              <label className="mg-field mg-grow">
                <span className="mg-label">Bottom bar</span>
                <select
                  className="mg-input"
                  value={settings.menuId ?? 'own'}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      menuId: event.target.value === 'own' ? null : Number(event.target.value),
                    })
                  }
                >
                  <option value="own">The capture’s own row</option>
                  {menus.map((menu) => (
                    <option key={menu.id} value={menu.id}>
                      {menu.name}
                    </option>
                  ))}
                </select>
              </label>
              {(destination.mode === 'pages' || destination.mode === 'story') && (
                <label className="mg-field">
                  <span className="mg-label">Role</span>
                  <select
                    className="mg-input"
                    value={settings.kind}
                    onChange={(event) => setSettings({ ...settings, kind: event.target.value as PageKind })}
                  >
                    {PAGE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_NAMES[kind]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className="mg-check">
              <input
                type="checkbox"
                checked={settings.shiftDown}
                onChange={(event) => setSettings({ ...settings, shiftDown: event.target.checked })}
              />
              Shift down one row <span className="mg-muted">(drops the capture’s last row)</span>
            </label>

            {verdict != null && (
              <p className={`mg-note${verdict.ok ? '' : ' mg-note-bad'}`} role="status">
                {verdict.text}
              </p>
            )}
            <button
              type="button"
              className="mg-btn mg-btn-primary mg-btn-block"
              disabled={locked || verdict?.ok !== true}
              onClick={onAdd}
            >
              {destination.mode === 'replace'
                ? 'Replace the screen'
                : destination.mode === 'story'
                  ? `Add 1 page with ${count} screens`
                  : destination.mode === 'screens'
                  ? `Add ${count} ${count === 1 ? 'screen' : 'screens'}`
                  : `Add ${count} ${count === 1 ? 'page' : 'pages'}`}
            </button>
          </>
        )}
      </footer>

      {previewing != null && (
        <CapturePreview
          capture={previewing}
          picked={pickedIds.includes(previewing.id)}
          settings={settings}
          menus={menus}
          loadPage={loadPage}
          transform={transform}
          onToggle={() => togglePick(previewing, false)}
          onClose={() => setPreviewing(null)}
        />
      )}
    </aside>
  );
}

/** One capture, large, beside what it would look like once published. */
function CapturePreview({
  capture,
  picked,
  settings,
  menus,
  loadPage,
  transform,
  onToggle,
  onClose,
}: {
  capture: CaptureSummary;
  picked: boolean;
  settings: AddSettings;
  menus: readonly CustomMenu[];
  loadPage(captureId: number): Promise<TeletextPage | null>;
  transform(page: TeletextPage, transforms: PublishTransforms): TeletextPage;
  onToggle(): void;
  onClose(): void;
}) {
  // Tagged with the capture it answers, so a late answer for another capture
  // is never shown against this one.
  const [loaded, setLoaded] = useState<{ id: number; page: TeletextPage | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadPage(capture.id).then((page) => {
      if (!cancelled) setLoaded({ id: capture.id, page });
    });
    return () => {
      cancelled = true;
    };
  }, [capture.id, loadPage]);

  const source = loaded?.id === capture.id ? loaded.page : null;
  const outgoing =
    source == null ? null : transform(source, { shiftDown: settings.shiftDown, menuId: settings.menuId });
  const menu = menus.find((m) => m.id === settings.menuId);

  return (
    <Dialog
      title={labelOf(capture)}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="mg-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="mg-btn mg-btn-primary"
            data-autofocus
            disabled={blockedReason(capture) != null}
            onClick={() => {
              onToggle();
              onClose();
            }}
          >
            {picked ? 'Unpick' : 'Pick'}
          </button>
        </>
      }
    >
      <div className="mg-compare">
        <figure>
          <figcaption className="mg-label">As captured</figcaption>
          <CaptureImage captureId={capture.id} hasImage={capture.has_image} label={labelOf(capture)} />
        </figure>
        <figure>
          <figcaption className="mg-label">
            As published — {settings.shiftDown ? 'shifted' : 'not shifted'}, {menu?.name ?? 'own bottom row'}
          </figcaption>
          {outgoing == null ? (
            <div className="mg-thumb mg-thumb-loading">{loaded == null ? 'Loading…' : 'No cells stored'}</div>
          ) : (
            <PageThumb page={outgoing} pageNumber={capture.original_page} scale={1} />
          )}
        </figure>
      </div>
      {menu != null && <MenuStrip items={menu.items} />}
      <p className="mg-note">
        {capture.manifest_title ?? 'No title in the manifest'} · {capture.topic ?? 'unfiled'} ·{' '}
        {describeSpan(capture)}
      </p>
    </Dialog>
  );
}
