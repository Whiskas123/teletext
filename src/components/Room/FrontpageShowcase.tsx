/**
 * The strip of pages under the wordmark.
 *
 * Real archive pages, running right to left and never stopping — a service on
 * air rather than a gallery of one. One page says "here is a page"; a strip
 * that keeps producing more says "there are hundreds", which is what the front
 * page is for.
 *
 * The pages are *chosen*, on `/manage`, and each one's picture was drawn once
 * at the moment it was chosen and stored. So this reads an ordered list and a
 * handful of `<img>`s — no cells, no canvas, no drawing at all in a visitor's
 * browser, where the strip used to redraw a dozen pages from 960 cells apiece
 * on every visit to show whatever happened to have the lowest numbers.
 *
 * The trade is that a picture is a snapshot: editing a page does not change the
 * strip until a moderator presses Redraw. That is the right way round for a
 * front page, which should show something chosen rather than whatever the
 * document holds this second.
 *
 * ## The loop is CSS, and the content is doubled
 *
 * The track holds the same screens twice and slides by exactly half its width,
 * so the moment the first copy has gone the second is sitting precisely where
 * it started. No timer, no index arithmetic, nothing to resynchronise — the
 * animation runs on the compositor and the component never re-renders for it.
 *
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  showcaseImageUrl,
  useShowcase,
  type ShowcaseEntry,
} from '../../collab/useShowcase';
import { SHOWCASE_SECONDS_PER_SCREEN, shuffleBySeed } from '../../domain/showcase';

export interface FrontpageShowcaseProps {
  /** Chosen: opens this page in the viewer. */
  onSelect(pageNumber: number, subpage: number): void;
  /** Names the region, and labels each tile, in the current language. */
  label: string;
  /** How a page number reads in a tile's name, e.g. `página 220`. */
  pageWord: string;
}

/** Whether the visitor has asked for less movement. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let list: MediaQueryList | undefined;
    try {
      list = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    if (list == null) return;
    const onChange = () => setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return reduced;
}


export function FrontpageShowcase({ onSelect, label, pageWord }: FrontpageShowcaseProps) {
  const { entries: chosen } = useShowcase();
  const reducedMotion = usePrefersReducedMotion();

  // One order per visit. The seed is drawn once, so a re-render — or a dropped
  // memo — reproduces the same order rather than reshuffling under the reader.
  const [seed] = useState(() => Math.random());
  const entries = useMemo(() => shuffleBySeed(chosen, seed), [chosen, seed]);

  // Nothing chosen yet, or the list has not arrived: the space stays empty,
  // which is what the front page looks like anyway. A placeholder for something
  // nobody was promised would be worse than the gap.
  if (entries.length === 0) return null;

  const caption = (entry: ShowcaseEntry) =>
    `${entry.page_number}${entry.subpage > 1 ? `-${entry.subpage}` : ''}`;

  return (
    <div
      className="frontpage-strip"
      aria-label={label}
      // Longer strips take proportionally longer, so pages cross at the same
      // speed whether there are three of them or twelve.
      style={
        {
          '--strip-seconds': `${entries.length * SHOWCASE_SECONDS_PER_SCREEN}s`,
        } as CSSProperties
      }
    >
      <div
        className={`frontpage-strip-track${reducedMotion ? ' frontpage-strip-still' : ''}`}
      >
        {/* Twice: the second copy is what the first slides away to reveal, and
            it is already in place when it does. `copy` is in the key because
            the same page legitimately appears in both. */}
        {[0, 1].map((copy) =>
          entries.map((entry) => (
            <button
              key={`${copy}-${entry.page_number}.${entry.subpage}`}
              type="button"
              className="frontpage-strip-tile"
              onClick={() => onSelect(entry.page_number, entry.subpage)}
              // The duplicate is decoration: announcing every page twice would
              // make the strip read as a service holding each page two times.
              aria-hidden={copy === 1 ? true : undefined}
              tabIndex={copy === 1 ? -1 : undefined}
              aria-label={`${pageWord} ${caption(entry)}${
                entry.title ? `, ${entry.title}` : ''
              }`}
            >
              <img
                className="teletext-thumbnail"
                src={showcaseImageUrl(
                  entry.page_number,
                  entry.subpage,
                  entry.updated_at,
                )}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {/* Decoration: the same words are already the button's own
                  accessible name, so a screen reader would hear them twice. */}
              <span className="frontpage-strip-caption" aria-hidden="true">
                <span className="frontpage-strip-caption-number">{caption(entry)}</span>
                {entry.title}
              </span>
            </button>
          )),
        )}
      </div>
    </div>
  );
}

export default FrontpageShowcase;
