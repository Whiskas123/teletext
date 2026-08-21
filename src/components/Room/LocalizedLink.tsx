/**
 * `Link` and `useLocalizedNavigate` — react-router's, with the current
 * language's prefix put back on.
 *
 * Every screen writes its destinations as language-independent paths (`/`,
 * `/watch`, `/about`), which is how they were written before the language moved
 * into the URL. Without this, following one from `/en/about` would land on the
 * Portuguese `/watch`: the link is absolute, so it drops the prefix and quietly
 * changes language halfway through a visit.
 *
 * Doing it here rather than at each call site means the ~19 destinations in the
 * app did not each have to learn about languages, and a new one cannot forget:
 * the import is `./LocalizedLink` instead of `react-router-dom`, and everything
 * else about it is the same.
 *
 * ## What is deliberately not localised
 *
 * A `to` that is not a string — an object with `search` or `state`, or a
 * relative path — passes through untouched. Relative navigation already
 * resolves against the current URL, prefix included, so prefixing it again
 * would double it. The three admin screens keep react-router's own `Link`,
 * because they are untranslated by design (see the note in `domain/copy.ts`)
 * and have no prefixed form to preserve.
 */

import { forwardRef } from 'react';
import { Link as RouterLink, type LinkProps } from 'react-router-dom';

import { localize } from './localizeTo';
import { useCurrentLanguage } from './languageContext';


export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, ...rest },
  ref,
) {
  const language = useCurrentLanguage();
  return <RouterLink ref={ref} to={localize(to, language)} {...rest} />;
});
