/**
 * Keeps the screen that mounts this out of search results.
 *
 * `index.html` is one file shared by every route, so `<meta name="robots">`
 * cannot be written there for some routes and not others — it would apply to
 * the whole site or to none of it. The tag is added and removed as the screen
 * comes and goes instead.
 *
 * ## Whether this works at all
 *
 * It works on Google, which renders the page before deciding, and it does not
 * work on a crawler that only reads the served HTML — where there is no tag,
 * because there is no JavaScript. That is the correct half to have:
 *
 * - The screens using this (`/moderator`, `/manage`, `/import`) are also named
 *   in `public/robots.txt`, which every crawler reads and which needs no
 *   JavaScript. This is the belt to that's braces, and it says something
 *   `robots.txt` cannot: `Disallow` asks a crawler not to *fetch* a URL, which
 *   still permits indexing it from inbound links alone, whereas `noindex` says
 *   not to list it. Both are worth having, and only together.
 * - {@link NotFound} uses it for a URL that does not exist. A crawler that does
 *   not render will see a 200 and the empty shell — unavoidable while the SPA
 *   rewrite is what serves every route — but Google, which does render, gets
 *   told plainly. Without this a mistyped URL is indexed as a copy of the front
 *   page.
 *
 * The tag is reference-counted, because `<meta name="robots">` is a property of
 * the document rather than of a component: two screens mounting it at once —
 * or, in `StrictMode`, one screen mounting twice — must not have the first
 * unmount remove a tag the second still needs.
 */

import { useEffect } from 'react';

const SELECTOR = 'meta[name="robots"][data-noindex]';
let mounted = 0;

export function useNoIndex(): void {
  useEffect(() => {
    mounted += 1;
    if (!document.head.querySelector(SELECTOR)) {
      const meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      meta.dataset.noindex = '';
      document.head.appendChild(meta);
    }

    return () => {
      mounted -= 1;
      if (mounted === 0) {
        document.head.querySelector(SELECTOR)?.remove();
      }
    };
  }, []);
}

export default useNoIndex;
