/**
 * The visitor's language, which is now part of the address.
 *
 * It used to be a `localStorage` key, and that had one fatal property: the two
 * languages shared a URL. Everything that does not run JavaScript — every
 * crawler, and every scraper that builds a link card — fetches a URL cold, with
 * no storage and no cookies, so a single address could only ever carry one
 * title and one description. Sharing an English reading of the site was
 * impossible; so was letting a search engine index one.
 *
 * The rules for the paths live in `domain/routes.ts`; this binds them to the
 * router. Reading the language is now `useLocation`, and choosing one is
 * navigation — which is the point, because it means a language is a place you
 * can link someone to.
 *
 * ## Why the preference is no longer remembered
 *
 * Storing it would mean either ignoring the store (dead weight) or redirecting
 * `/` on the strength of it — and that second one is the trap. A crawler
 * arrives with no storage, so it would be sent somewhere a returning human is
 * not, and Google's own guidance is not to vary a URL's language by anything it
 * cannot see. The URL is the whole state now, which is also what makes it
 * shareable and bookmarkable.
 */

import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { otherLanguage, type Language } from '../../domain/landing';
import { switchLanguagePath } from '../../domain/routes';
import { useCurrentLanguage } from './languageContext';

export interface LanguageApi {
  language: Language;
  /** The one it is not, which is the only thing a two-sided toggle offers. */
  other: Language;
  setLanguage(next: Language): void;
  toggle(): void;
}

export function useLanguage(): LanguageApi {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const language = useCurrentLanguage();

  const setLanguage = useCallback(
    (next: Language) => {
      // The same address in the other language, not the front page: switching
      // language while reading page 220 should keep you on page 220.
      navigate(switchLanguagePath(pathname, next));
    },
    [navigate, pathname],
  );

  const toggle = useCallback(() => {
    setLanguage(otherLanguage(language));
  }, [language, setLanguage]);

  return { language, other: otherLanguage(language), setLanguage, toggle };
}
