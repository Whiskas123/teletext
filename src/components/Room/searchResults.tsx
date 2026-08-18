/**
 * The rows a text search answers with, printed as listings in the same book.
 *
 * Shared by the room's {@link PageSearch} popup and by the search field built
 * into the solo viewer's directory leaflet. The hits themselves come from
 * {@link usePageSearchHits}.
 */

import type { SearchHit } from '../../domain/pageSearch';
import { formatPageNumber } from './directoryRows';

/** The snippet with the matched run marked, so the eye lands on it. */
export function Snippet({ hit }: { hit: SearchHit }) {
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

export interface SearchResultsProps {
  hits: readonly SearchHit[];
  /** Called with the page a result names, and the screen it matched on. */
  onPick: (pageNumber: number, subpage: number) => void;
  /** Extra classes for the list — the leaflet scrolls it with its own body. */
  className?: string;
}

/**
 * The hits as a single column of rows: a result is two lines, so the
 * top-to-bottom-then-next-column flow the directory uses would be hard to
 * follow here.
 */
export function SearchResults({ hits, onPick, className }: SearchResultsProps) {
  return (
    <ul className={`page-search-list${className ? ` ${className}` : ''}`}>
      {hits.map((hit) => (
        <li key={`${hit.pageNumber}.${hit.subpage}`} className="yellow-pages-entry">
          <button
            type="button"
            className="yellow-pages-entry-btn page-search-result"
            onClick={() => onPick(hit.pageNumber, hit.subpage)}
          >
            <span className="page-search-head">
              <span className="yellow-pages-name">
                {hit.title.trim().length > 0 ? hit.title : 'Untitled listing'}
              </span>
              <span className="yellow-pages-leader" aria-hidden="true" />
              <span className="yellow-pages-number">
                {formatPageNumber(hit.pageNumber)}
                {/* Only when there is one to name: `220` on a page with a single
                    screen, `220-2` when the hit is on the second of several. */}
                {hit.subpage > 1 ? `-${hit.subpage}` : ''}
              </span>
            </span>
            <span className="page-search-snippet">
              {hit.inTitle ? (
                <em>matches the title</em>
              ) : (
                <>
                  <span className="page-search-row">row {(hit.row ?? 0) + 1}</span>
                  <Snippet hit={hit} />
                </>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
