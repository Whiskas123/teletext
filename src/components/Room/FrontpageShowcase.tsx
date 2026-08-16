/**
 * The strip of pages under the wordmark.
 *
 * Real archive pages, running right to left and never stopping — a service on
 * air rather than a gallery of one. One page says "here is a page"; a strip
 * that keeps producing more says "there are hundreds", which is what the front
 * page is for.
 *
 * They come from the same live document the viewer reads, so the strip shows
 * what is genuinely published rather than screenshots that drift out of date,
 * and choosing one opens that page.
 *
 * ## The loop is CSS, and the content is doubled
 *
 * The track holds the same screens twice and slides by exactly half its width,
 * so the moment the first copy has gone the second is sitting precisely where
 * it started. No timer, no index arithmetic, nothing to resynchronise — the
 * animation runs on the compositor and the component never re-renders for it.
 *
 * Each tile is a canvas ({@link TeletextThumbnail}) rather than the interactive
 * grid: nothing on the strip is clicked *into*, so per-cell elements would buy
 * nothing and cost ~1,500 DOM nodes each.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { usePageData } from '@playhtml/react';

import { PAGES_CHANNEL } from '../../collab/useEditPage';
import { useGuide } from '../../collab/useGuide';
import { normalizePage } from '../../domain/pageOps';
import {
  SHOWCASE_SECONDS_PER_SCREEN,
  SHOWCASE_STRIP,
  initialGrid,
  showcaseScreens,
} from '../../domain/showcase';
import {
  SUBPAGE_COUNTS_CHANNEL,
  pageKey,
  type SubpageCounts,
} from '../../domain/subpages';
import type { PagesData } from '../../collab/types';
import { TeletextThumbnail } from '../TeletextGrid/TeletextThumbnail';

/**
 * Backing store per tile, as a fraction of the page's natural size.
 *
 * Raised with the tile width: a canvas drawn smaller than it is displayed goes
 * soft, and a 280px tile on a 2x screen wants 560px of pixels. Not 1.0, because
 * two dozen canvases at full size is four times the memory for detail nobody
 * can see at this size.
 */
const TILE_SCALE = 0.75;

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
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [counts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  // Titles for the hover caption, from the same place the directory reads them.
  const { title } = useGuide();
  const reducedMotion = usePrefersReducedMotion();

  const screens = useMemo(
    () => showcaseScreens(pages as Record<string, unknown>, counts),
    [pages, counts],
  );

  // Where this visit's run begins. A lazy initializer rather than
  // `useRef(Math.random())`, whose argument is evaluated on every render.
  const [seed] = useState(() => Math.random());

  const riding = useMemo(
    () => initialGrid(screens.length, seed, SHOWCASE_STRIP),
    [screens.length, seed],
  );

  // Nothing on air, or nothing synced yet: the space stays empty, which is what
  // the front page looks like anyway.
  if (riding.length === 0) return null;

  return (
    <div
      className="frontpage-strip"
      aria-label={label}
      // Longer strips take proportionally longer, so pages cross at the same
      // speed whether there are three of them or twelve.
      style={
        {
          '--strip-seconds': `${riding.length * SHOWCASE_SECONDS_PER_SCREEN}s`,
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
          riding.map((index) => {
            const screen = screens[index];
            if (screen == null) return null;
            const page = normalizePage(
              (pages as Record<string, unknown> | null)?.[
                String(pageKey(screen.pageNumber, screen.subpage))
              ],
            );

            return (
              <button
                key={`${copy}-${index}`}
                type="button"
                className="frontpage-strip-tile"
                onClick={() => onSelect(screen.pageNumber, screen.subpage)}
                // The duplicate is decoration: announcing every page twice would
                // make the strip read as a service holding each page two times.
                aria-hidden={copy === 1 ? true : undefined}
                tabIndex={copy === 1 ? -1 : undefined}
                aria-label={`${pageWord} ${screen.pageNumber}${
                  screen.subpageCount > 1 ? `-${screen.subpage}` : ''
                }${title(screen.pageNumber) ? `, ${title(screen.pageNumber)}` : ''}`}
              >
                <TeletextThumbnail
                  page={page}
                  pageNumber={screen.pageNumber}
                  subpage={screen.subpage}
                  subpageCount={screen.subpageCount}
                  scale={TILE_SCALE}
                />
                {/* Decoration: the same words are already the button's own
                    accessible name, so a screen reader would hear them twice. */}
                <span className="frontpage-strip-caption" aria-hidden="true">
                  <span className="frontpage-strip-caption-number">
                    {screen.pageNumber}
                    {screen.subpageCount > 1 ? `-${screen.subpage}` : ''}
                  </span>
                  {title(screen.pageNumber)}
                </span>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

export default FrontpageShowcase;
