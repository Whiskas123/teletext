/**
 * Browsing the corpus: filters, a grid of real renders, and a pager.
 *
 * Organised by **topic** — the on-disk folder division — and era rather than by
 * page number, because page numbers were reused for unrelated content over the
 * years: the four captures sharing page 220 are usually four different pages,
 * not four versions of one. Choosing between them means reading what is on them,
 * which is why every capture shows its actual render.
 *
 * ## The search box that was missing
 *
 * `CaptureFilters.q` has been plumbed through the hook and handled by
 * `api/captures/index.ts` all along, matching manifest titles and corpus
 * filenames. Nothing was ever wired to it, so the only way to find a capture was
 * to page through hundreds of renders sixty at a time.
 */

import type { CaptureFilters, CaptureSummary } from '../../collab/useArchiveAdmin';
import { noCaptureMatch } from '../../domain/manageMessages';
import { CaptureImage } from '../TeletextGrid/CaptureImage';
import { MAX_CAPTURE_QUERY, blockedReason, describeSpan } from './captureMeta';

/** Topic folders, as the corpus is filed. */
const TOPIC_GROUPS = [
  'noticias', 'desporto', 'televisao', 'cultura', 'economia', 'meteorologia',
  'utilidades', 'horoscopo', 'publicidade', 'servicos-sms', 'indice',
  'passatempos', 'jogos-sorte', 'diario-republica', 'classificados', 'eventos',
] as const;

const SCHEMES = ['1998-2000', '2001-2005', '2006-2010'] as const;

export interface CaptureBrowserProps {
  /** The filters as typed, including the not-yet-debounced free-text term. */
  filters: CaptureFilters;
  /** The filters the displayed results answer, for an honest empty message. */
  appliedFilters: CaptureFilters;
  onChangeFilters(update: (current: CaptureFilters) => CaptureFilters): void;
  onClearFilters(): void;
  captures: readonly CaptureSummary[];
  total: number;
  offset: number;
  pageSize: number;
  onOffset(offset: number): void;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  selectedId: number | null;
  onSelect(capture: CaptureSummary): void;
}

export function CaptureBrowser({
  filters,
  appliedFilters,
  onChangeFilters,
  onClearFilters,
  captures,
  total,
  offset,
  pageSize,
  onOffset,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
}: CaptureBrowserProps) {
  return (
    <section className="manage-results" aria-label="Captures">
      <div className="manage-filters" role="search">
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-q">
            Search titles and filenames
          </label>
          <input
            id="manage-q"
            type="search"
            className="landing-name-input"
            maxLength={MAX_CAPTURE_QUERY}
            placeholder="e.g. lisboa"
            // The term is held as typed and trimmed only on its way to the query,
            // so a space mid-thought is not eaten between keystrokes.
            value={filters.q ?? ''}
            onChange={(e) =>
              onChangeFilters((f) => ({ ...f, q: e.target.value || undefined }))
            }
          />
        </span>

        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-topic">Topic</label>
          <select
            id="manage-topic"
            value={filters.topicGroup ?? ''}
            onChange={(e) =>
              onChangeFilters((f) => ({ ...f, topicGroup: e.target.value || undefined }))
            }
          >
            <option value="">All topics</option>
            {TOPIC_GROUPS.map((topic) => (
              <option key={topic} value={topic}>{topic}</option>
            ))}
          </select>
        </span>

        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-source">Source</label>
          <select
            id="manage-source"
            value={filters.source ?? ''}
            onChange={(e) =>
              onChangeFilters((f) => ({ ...f, source: e.target.value || undefined }))
            }
          >
            <option value="">RTP and SIC</option>
            <option value="rtp">RTP</option>
            <option value="sic">SIC</option>
          </select>
        </span>

        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-scheme">Era</label>
          <select
            id="manage-scheme"
            value={filters.scheme ?? ''}
            onChange={(e) =>
              onChangeFilters((f) => ({ ...f, scheme: e.target.value || undefined }))
            }
          >
            <option value="">All years</option>
            {SCHEMES.map((scheme) => (
              <option key={scheme} value={scheme}>{scheme}</option>
            ))}
          </select>
        </span>

        <span className="manage-reorder-field">
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
              onChangeFilters((f) => ({
                ...f,
                page: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
          />
        </span>

        <label className="manage-checkbox">
          <input
            type="checkbox"
            checked={filters.undecoded ?? false}
            onChange={(e) =>
              onChangeFilters((f) => ({ ...f, undecoded: e.target.checked || undefined }))
            }
          />
          Include captures that cannot be decoded
        </label>
      </div>

      {error != null ? (
        <div className="manage-load-error" role="alert">
          <p className="manage-note manage-note-error">{error}</p>
          <button type="button" className="manage-mini-btn" onClick={onRetry}>
            Try that search again
          </button>
        </div>
      ) : loading ? (
        <p className="landing-section-description">Loading…</p>
      ) : captures.length === 0 ? (
        <div className="manage-no-match">
          <p className="landing-section-description">{noCaptureMatch(appliedFilters)}</p>
          <button type="button" className="manage-mini-btn" onClick={onClearFilters}>
            Clear all filters
          </button>
        </div>
      ) : (
        <ul className="manage-capture-grid">
          {captures.map((capture) => {
            const reason = blockedReason(capture);
            return (
              <li key={capture.id}>
                <button
                  type="button"
                  className={`manage-capture${
                    selectedId === capture.id ? ' manage-capture-selected' : ''
                  }`}
                  aria-pressed={selectedId === capture.id}
                  onClick={() => onSelect(capture)}
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
                    {capture.capture_count > 1 && (
                      <span>seen {capture.capture_count} days</span>
                    )}
                    {reason != null && <span className="manage-note-error">{reason}</span>}
                    {capture.snapped_pixels > 0 && (
                      <span className="manage-note-error">
                        {capture.snapped_pixels} suspect px
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > pageSize && (
        /*
         * Without this the browser only ever showed the first 60 captures by page
         * number — which are all `indice`, because that is what pages 100-102
         * are. "All topics" looked broken when it was really just the first page
         * of an ordered list.
         */
        <nav className="manage-pager" aria-label="Result pages">
          <button
            type="button"
            className="manage-mini-btn"
            disabled={offset === 0}
            onClick={() => onOffset(Math.max(0, offset - pageSize))}
          >
            ‹ Previous
          </button>
          <span className="manage-note">
            {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
          </span>
          <button
            type="button"
            className="manage-mini-btn"
            disabled={offset + pageSize >= total}
            onClick={() => onOffset(offset + pageSize)}
          >
            Next ›
          </button>
        </nav>
      )}
    </section>
  );
}
