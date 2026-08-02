/**
 * PageSearch — find a page by what is written on it.
 *
 * The Yellow Pages answers "what is on this service?". This answers "which page
 * said that?", which is the question you actually have once there are a few
 * hundred pages: a football result, a phone number, a headline you half
 * remember.
 *
 * Matching lives in `domain/pageSearch.ts` — reading text back out of a 40x24
 * grid has enough teletext-specific catches (graphics cells, layout padding,
 * Portuguese accents) to be worth testing on its own.
 *
 * Styled as the same printed directory as the Yellow Pages, since it is the
 * same book with a different index.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { useGuide } from '../../collab/useGuide';
import { PAGES_CHANNEL } from '../../collab/useEditPage';
import type { PagesData } from '../../collab/types';
import {
  MIN_QUERY_LENGTH,
  searchPages,
  type SearchHit,
} from '../../domain/pageSearch';

export interface PageSearchProps {
  /** Called with a listing's page number when it is chosen. */
  onSelect: (pageNumber: number) => void;
  /** Close the popup. */
  onClose: () => void;
}

/** Format a page number as three digits. */
function formatPageNumber(n: number): string {
  return String(n).padStart(3, '0');
}

/** The snippet with the matched run marked, so the eye lands on it. */
function Snippet({ hit }: { hit: SearchHit }) {
  if (hit.match == null) return <span>{hit.snippet}</span>;
  const { start, end } = hit.match;
  return (
    <span>
      {hit.snippet.slice(0, start)}
      <mark className="page-search-mark">{hit.snippet.slice(start, end)}</mark>
      {hit.snippet.slice(end)}
    </span>
  );
}

export function PageSearch({ onSelect, onClose }: PageSearchProps) {
  const { entries } = useGuide();
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Searched over the guide's listing rather than every key in the document, so
   * a page that is empty and untitled — a slot someone cleared — is not a
   * result. The guide is already the definition of "a page that exists".
   */
  const hits = useMemo(
    () =>
      searchPages(
        entries.map((entry) => ({
          pageNumber: entry.pageNumber,
          title: entry.title,
          page: pages?.[entry.pageNumber],
        })),
        query,
      ),
    [entries, pages, query],
  );

  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div
      className="yellow-pages-overlay"
      role="dialog"
      aria-label="Search pages"
      onClick={onClose}
    >
      <div className="yellow-pages-book" onClick={(e) => e.stopPropagation()}>
        <div className="yellow-pages-masthead">
          <span className="yellow-pages-brand">Search</span>
          <button
            type="button"
            className="yellow-pages-close"
            onClick={onClose}
            aria-label="Close search"
          >
            ×
          </button>
        </div>

        <input
          className="page-search-input"
          type="search"
          value={query}
          autoFocus
          placeholder="Find a word on any page…"
          aria-label="Search pages by text"
          onChange={(e) => setQuery(e.target.value)}
        />

        <hr className="yellow-pages-rule" />

        {query.trim().length === 0 ? (
          <p className="yellow-pages-empty">
            Type to search every page&rsquo;s title and text. Accents and capitals
            do not matter.
          </p>
        ) : tooShort ? (
          <p className="yellow-pages-empty">
            Keep going — at least {MIN_QUERY_LENGTH} characters.
          </p>
        ) : hits.length === 0 ? (
          <p className="yellow-pages-empty">
            Nothing found for &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <>
            <p className="yellow-pages-tagline">
              {hits.length} page{hits.length === 1 ? '' : 's'} found
            </p>
            <ul className="page-search-list">
              {hits.map((hit) => (
                <li key={hit.pageNumber} className="yellow-pages-entry">
                  <button
                    type="button"
                    className="yellow-pages-entry-btn page-search-result"
                    onClick={() => {
                      onSelect(hit.pageNumber);
                      onClose();
                    }}
                  >
                    <span className="page-search-head">
                      <span className="yellow-pages-name">
                        {hit.title.trim().length > 0 ? hit.title : 'Untitled listing'}
                      </span>
                      <span className="yellow-pages-leader" aria-hidden="true" />
                      <span className="yellow-pages-number">
                        {formatPageNumber(hit.pageNumber)}
                      </span>
                    </span>
                    <span className="page-search-snippet">
                      {hit.inTitle ? (
                        <em>matches the title</em>
                      ) : (
                        <>
                          <span className="page-search-row">
                            row {(hit.row ?? 0) + 1}
                          </span>
                          <Snippet hit={hit} />
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="yellow-pages-footnote">Tap a result to request that page.</p>
      </div>
    </div>
  );
}

export default PageSearch;
