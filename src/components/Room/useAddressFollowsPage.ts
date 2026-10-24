/**
 * The address and the tab title follow the page being watched.
 *
 * The viewer reads its page from the URL once and keeps it as local state, so
 * the remote, a link on the page, the Yellow Pages or the search all change
 * the page without touching the address. Left alone, a reload or a shared link
 * went back to whatever page the visit started on, and the tab kept that
 * page's title.
 *
 * So the address is *replaced* with the page's own (`pagePath`, under the
 * visitor's language, with the query — `?exhibit=1` — kept), and `document.title`
 * is set from the same `pageMeta` the prerenderer writes into that address's
 * HTML, so the two say the same thing. Replaced rather than pushed: stepping
 * through fifty pages with the arrows is not fifty places to go back to, and
 * the back button keeps meaning "leave the television".
 *
 * When the viewer closes, the tab takes the title of wherever the visitor went
 * (`routeMeta`, the same table the prerenderer reads), so the next screen does
 * not carry a page's name. Not the title from before the viewer opened: arrive
 * straight at `/watch/104` and that is page 104's own, from the static HTML.
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { usePageTitles } from '../../collab/useGuide';
import { localizePath, readLanguagePath } from '../../domain/routes';
import { pageMeta, pagePath, routeMeta } from '../../domain/seo';
import { useCurrentLanguage } from './languageContext';

export function useAddressFollowsPage(pageNumber: number, subpage: number, kiosk = false): void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const language = useCurrentLanguage();
  const { title } = usePageTitles();
  const pageTitle = title(pageNumber);

  // By the time this cleanup runs the router has moved, so the address is the
  // screen being opened.
  useEffect(
    () => () => {
      const next = readLanguagePath(window.location.pathname);
      document.title = routeMeta(next.path, next.language).title;
    },
    [],
  );

  useEffect(() => {
    const path = pagePath(pageNumber, subpage);
    const target = localizePath(kiosk ? path.replace(/^\/watch/, '/kiosk') : path, language);
    if (target !== pathname) navigate({ pathname: target, search }, { replace: true });
  }, [pageNumber, subpage, kiosk, language, pathname, search, navigate]);

  useEffect(() => {
    document.title = pageMeta({ pageNumber, subpage, title: pageTitle }, language).title;
  }, [pageNumber, subpage, pageTitle, language]);
}
