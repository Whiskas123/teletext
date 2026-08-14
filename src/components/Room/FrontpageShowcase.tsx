/**
 * The page on air beside the front page's menu.
 *
 * One real archive page, cycling — the front page's empty right half is a
 * page-shaped hole, and filling it with the medium itself says what the project
 * is faster than a paragraph about teletext could. It reads the same live
 * document the viewer reads, so it shows what is genuinely published rather
 * than a set of screenshots that can drift out of date, and choosing it opens
 * that page.
 *
 * Which screens are eligible, and the order they run in, is
 * `domain/showcase.ts`; this binds it to playhtml and to a timer.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { PAGES_CHANNEL } from '../../collab/useEditPage';
import { normalizePage } from '../../domain/pageOps';
import {
  SHOWCASE_INTERVAL_MS,
  nextIndex,
  showcaseScreens,
  startIndex,
} from '../../domain/showcase';
import {
  SUBPAGE_COUNTS_CHANNEL,
  pageKey,
  type SubpageCounts,
} from '../../domain/subpages';
import type { PagesData } from '../../collab/types';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';

export interface FrontpageShowcaseProps {
  /** Chosen: opens this page in the viewer. */
  onSelect(pageNumber: number, subpage: number): void;
  /** Names the region, and labels the control, in the current language. */
  label: string;
  /** How the page number reads under the screen, e.g. `página 220`. */
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
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query == null) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function FrontpageShowcase({ onSelect, label, pageWord }: FrontpageShowcaseProps) {
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [counts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  const reducedMotion = usePrefersReducedMotion();

  const screens = useMemo(
    () => showcaseScreens(pages as Record<string, unknown>, counts),
    [pages, counts],
  );

  // Where this visit starts.
  //
  // A lazy initializer rather than `useRef(Math.random())`: a ref's argument is
  // evaluated on *every* render even though only the first is kept, so that
  // form draws a fresh number each time the live document syncs another page —
  // impure in render, and the rotation would jump.
  const [seed] = useState(() => Math.random());
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Auto-advancing content is exactly what the reduced-motion preference is
    // about, so with it set the showcase holds one page and stays there.
    if (reducedMotion || screens.length <= 1) return;
    const timer = setInterval(
      () => setStep((current) => current + 1),
      SHOWCASE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [reducedMotion, screens.length]);

  // Nothing on air, or nothing synced yet: the space stays empty, which is what
  // the front page looks like anyway. A spinner in a hole nobody was promised
  // anything in would be worse than the hole.
  if (screens.length === 0) return null;

  // The step is folded into range on read, so a document that shrinks under a
  // running timer cannot leave the index pointing past the end.
  let index = startIndex(screens.length, seed);
  for (let i = 0; i < step % screens.length; i += 1) {
    index = nextIndex(index, screens.length);
  }
  const screen = screens[index];
  const page = normalizePage(
    (pages as Record<string, unknown> | null)?.[
      String(pageKey(screen.pageNumber, screen.subpage))
    ],
  );

  return (
    <div className="frontpage-showcase" aria-label={label}>
      <button
        type="button"
        className="frontpage-showcase-btn"
        onClick={() => onSelect(screen.pageNumber, screen.subpage)}
        aria-label={`${label}: ${pageWord} ${screen.pageNumber}${
          screen.subpageCount > 1 ? `-${screen.subpage}` : ''
        }`}
      >
        <TeletextGrid
          page={page}
          pageNumber={screen.pageNumber}
          subpage={screen.subpage}
          subpageCount={screen.subpageCount}
          readOnly
        />
      </button>
      {/*
        * No caption under the screen.
        *
        * A teletext page carries its own number in its header — `102 1/1`, top
        * left, in the palette — so a line beneath repeating it in a second
        * typeface said nothing new and cost the object its alignment: the
        * screen's bottom edge is meant to land on the menu's, and a caption
        * hanging below pushed it 25px short. The page number reaches a screen
        * reader through the button's own name instead.
        */}
    </div>
  );
}

export default FrontpageShowcase;
