/**
 * YellowPagesDrawer — the directory as a leaflet folded against the left edge
 * of the screen.
 *
 * Watching solo, the props that used to stand under the television are gone and
 * the set is the whole picture. The directory still has to be reachable, so it
 * becomes the one thing beside it: a yellow book closed flat against the edge,
 * showing nothing but a thumb tab. Pull the tab and it opens out — the listings
 * in one scrolling column, with the search field at the top of them, because
 * "what is on this service?" and "which page said that?" are two ways of
 * looking something up in the same book and there is no reason to keep them in
 * separate ones.
 *
 * The rows are {@link DirectoryList} and the results are {@link SearchResults};
 * this file is the furniture around them.
 *
 * It used to be one of three ways into the same listings — there were also a
 * full-screen directory popup and a separate search popup, reached from
 * photographs of a book and a magnifying glass under the room's television.
 * Those are gone, along with the photographs: the leaflet is the only directory
 * now, on both watching screens, and the search field at the top of it is the
 * only search.
 */

import { useEffect, useRef, useState } from 'react';

import { MIN_QUERY_LENGTH } from '../../domain/pageSearch';
import DirectoryList from './DirectoryList';
import { useDirectory, useOpenSections } from './directoryRows';
import { SearchResults } from './searchResults';
import { usePageSearchHits } from './usePageSearchHits';
import { useCopy } from './useCopy';

/** The panel's id, so the tab can say what it opens. */
const PANEL_ID = 'yellow-pages-drawer-panel';

export interface YellowPagesDrawerProps {
  /** Whether the leaflet is open. Owned by the viewer, which shifts the set. */
  open: boolean;
  /** Pull the tab: open a closed leaflet, fold an open one. */
  onToggle: () => void;
  /** Fold it — Escape, and whatever else the viewer decides should close it. */
  onClose: () => void;
  /**
   * Called with the page a listing or a result names. A search result also
   * carries the screen it matched on, so choosing it lands on the words that
   * were found rather than on the first screen of the carousel holding them.
   */
  onSelect: (pageNumber: number, subpage?: number) => void;
}

export function YellowPagesDrawer({
  open,
  onToggle,
  onClose,
  onSelect,
}: YellowPagesDrawerProps) {
  const copy = useCopy();
  const { entries, blocks, counts } = useDirectory();
  const { openSections, toggleSection } = useOpenSections();

  const [query, setQuery] = useState('');
  const hits = usePageSearchHits(query);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const tooShort = searching && trimmed.length < MIN_QUERY_LENGTH;

  /**
   * Whether the search field is out.
   *
   * Folded away by default, because it is the answer to a question you only
   * sometimes have and the listings are what you came for. A field, its
   * placeholder and the rule under it were costing three rows of directory on
   * every phone that opened the book without wanting to search anything.
   */
  const [searchOpen, setSearchOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  // Out of the way and typed into in one tap, rather than two.
  useEffect(() => {
    if (searchOpen) fieldRef.current?.focus();
  }, [searchOpen]);

  // Putting the field away clears it: a query that went on filtering the
  // directory from behind a closed field would look like a directory missing
  // most of its pages.
  const toggleSearch = () => {
    setSearchOpen((wasOpen) => {
      if (wasOpen) setQuery('');
      return !wasOpen;
    });
  };

  // Escape folds it, as it closed the popup this replaces. Only while open, so
  // it does not swallow the key from anything else on the watching screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`yp-drawer${open ? ' yp-drawer-open' : ''}`}>
      {/*
        * `inert` while folded rather than `display: none`: the leaflet slides,
        * so it has to stay laid out, and a panel sitting off the left edge of
        * the screen is still tabbable and still read aloud unless it is said
        * not to be.
        */}
      <div
        className="yellow-pages-book yp-drawer-leaflet"
        id={PANEL_ID}
        role="region"
        aria-label={copy.directory.title}
        inert={!open}
      >
        <div className="yellow-pages-masthead yp-drawer-masthead">
          <span className="yellow-pages-brand">{copy.directory.title}</span>
          <div className="yp-drawer-tools">
            <button
              type="button"
              className="yp-drawer-tool"
              onClick={toggleSearch}
              aria-expanded={searchOpen}
              aria-controls="yp-drawer-search"
              aria-label={searchOpen ? copy.directory.searchClose : copy.directory.searchOpen}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <circle
                  cx="6.75"
                  cy="6.75"
                  r="4.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                />
                <line
                  x1="10.4"
                  y1="10.4"
                  x2="14.6"
                  y2="14.6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="yellow-pages-close"
              onClick={onClose}
              aria-label={copy.directory.close}
            >
              ×
            </button>
          </div>
        </div>

        {searchOpen && (
          <input
            id="yp-drawer-search"
            ref={fieldRef}
            className="page-search-input"
            type="search"
            value={query}
            placeholder={copy.directory.searchPlaceholder}
            aria-label={copy.directory.searchOpen}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        <hr className="yellow-pages-rule" />

        {/*
          * One scrolling column. The book turns sheets because it has a whole
          * screen of columns to turn; a leaflet down the side of the set has
          * one column's width and nothing to turn, so it scrolls.
          */}
        <div className="yp-drawer-body">
          {searching ? (
            tooShort ? (
              <p className="yellow-pages-empty">
                {copy.directory.tooShort(MIN_QUERY_LENGTH)}
              </p>
            ) : hits.length === 0 ? (
              <p className="yellow-pages-empty">
                {copy.directory.noResults}
              </p>
            ) : (
              <>
                <p className="yellow-pages-tagline">
                  {copy.directory.resultsFound(hits.length)}
                </p>
                <SearchResults
                  hits={hits}
                  onPick={(pageNumber, subpage) => onSelect(pageNumber, subpage)}
                  className="yp-drawer-results"
                />
              </>
            )
          ) : entries.length === 0 ? (
            <p className="yellow-pages-empty">
              {copy.directory.noListings}
            </p>
          ) : (
            <DirectoryList
              blocks={blocks}
              counts={counts}
              openSections={openSections}
              onToggleSection={toggleSection}
              onPick={(pageNumber) => onSelect(pageNumber)}
            />
          )}
        </div>

      </div>

      {/*
        * The tab, which rides on the leaflet's outer edge: closed it is the only
        * part showing, open it is the corner you fold the thing back by. Same
        * control either way, which is why it moves with the panel rather than
        * being pinned to the edge of the window.
        */}
      <button
        type="button"
        className="yp-drawer-knob"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? copy.directory.close : copy.directory.open}
      >
        <span className="yp-drawer-knob-label" aria-hidden="true">
          {copy.directory.title}
        </span>
      </button>
    </div>
  );
}

export default YellowPagesDrawer;
