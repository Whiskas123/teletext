/**
 * PageSearch — find a page by what is written on it.
 *
 * The Yellow Pages answers "what is on this service?". This answers "which page
 * said that?", which is the question you actually have once there are a few
 * hundred pages: a football result, a phone number, a headline you half
 * remember.
 *
 * The hits and the rows that show them live in {@link searchResults}, shared
 * with the search field built into the solo viewer's directory drawer; matching
 * lives in `domain/pageSearch.ts`.
 *
 * Styled as the same printed directory as the Yellow Pages, since it is the
 * same book with a different index.
 */

import { useEffect, useState } from 'react';

import { MIN_QUERY_LENGTH } from '../../domain/pageSearch';
import { SearchResults } from './searchResults';
import { usePageSearchHits } from './usePageSearchHits';

export interface PageSearchProps {
  /**
   * Called with a listing's page number when it is chosen, and the screen of
   * its carousel the match was on. Watching solo goes straight there; a room
   * votes on the page and starts it at the first screen, since the vote is
   * about which page the room watches.
   */
  onSelect: (pageNumber: number, subpage: number) => void;
  /** Close the popup. */
  onClose: () => void;
}

export function PageSearch({ onSelect, onClose }: PageSearchProps) {
  const [query, setQuery] = useState('');
  const hits = usePageSearchHits(query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
              {hits.length} result{hits.length === 1 ? '' : 's'} found
            </p>
            <SearchResults
              hits={hits}
              onPick={(pageNumber, subpage) => {
                onSelect(pageNumber, subpage);
                onClose();
              }}
            />
          </>
        )}

        <p className="yellow-pages-footnote">Tap a result to request that page.</p>
      </div>
    </div>
  );
}

export default PageSearch;
