import { Link } from './LocalizedLink';

import { useNoIndex } from '../../utils/useNoIndex';
import { useCopy } from './useCopy';

/**
 * NotFound — what a URL that is not a route now shows.
 *
 * ## What it replaces
 *
 * A `<Navigate to="/" replace />` on the catch-all. That was wrong twice over.
 *
 * For a person, it threw away the thing they typed: arriving at the front page
 * with no explanation reads as the address having worked and the site having
 * forgotten it, and there is nothing to correct because the URL is gone from
 * the bar. Saying "this address does not exist" is the smaller and more useful
 * answer.
 *
 * For a crawler, it was a soft 404 — the worst shape a missing page can take.
 * `vercel.json` rewrites every unmatched path to `index.html` with a 200, so a
 * mistyped URL, an old link, and a probe for `/wp-admin` all answered *success*
 * and then rendered the front page. Google treats a page that returns 200 while
 * being a duplicate of the home page as a quality problem for the site, not as
 * one bad URL.
 *
 * ## Why it does not return a 404 status
 *
 * It cannot, from here. The status is decided by the rewrite in `vercel.json`
 * before any JavaScript runs, and this is a static deployment: there is no
 * server rendering the route to set one. {@link useNoIndex} is what is
 * available instead — Google renders the page and honours the `noindex` it
 * finds, which keeps the URL out of the index even though the status lied.
 *
 * A real 404 needs the same thing archive pages need in order to be indexed at
 * all: something server-side in front of the routes. Both should arrive
 * together.
 */
export function NotFound() {
  const copy = useCopy();
  useNoIndex();

  return (
    <div className="about">
      <header className="about-head">
        <Link to="/" className="room-back-link" aria-label={copy.layout.backHome}>
          <span className="room-back-arrow" aria-hidden="true">
            &lt;
          </span>
          <img src="/logo.png" alt="" className="room-back-logo" />
        </Link>
      </header>

      {/* The about screen's shell, class for class: same gutters, same measure,
          same face. A screen reached by accident is not the place to introduce
          a layout, and the two are one click apart. */}
      <main className="about-body" aria-label={copy.notFound.region}>
        <h1 className="about-title teletext-fg-red">{copy.notFound.title}</h1>
        <p className="about-para">{copy.notFound.message}</p>
        {/* Only the archive. The way back to the front page is the logo in the
            header, where it is on every other screen — offering it twice would
            put two links with the same accessible name on a screen whose whole
            job is to be read once and left. */}
        <p className="about-para">
          <Link to="/watch" className="about-link">
            {copy.notFound.watch}
          </Link>
        </p>
      </main>
    </div>
  );
}

export default NotFound;
