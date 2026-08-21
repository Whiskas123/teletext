/**
 * Which language this subtree is being read in.
 *
 * `App` mounts the route tree twice — once under `/en`, once bare — and each
 * mount states its language here. Everything below reads it from context rather
 * than parsing the URL again.
 *
 * ## Why this is context and not just `useLocation`
 *
 * Because of who asks. {@link useCopy} is how roughly forty components get
 * their words, including small ones like the connection indicator and the
 * presence list, and reading the language through a router hook would make
 * *all* of them impossible to render without a `<Router>` around them —
 * including in tests, where they were rendered bare because they have nothing
 * to do with routing.
 *
 * Reading the language and changing it are different jobs with different
 * requirements, so they are separated: this is the read, and it works anywhere,
 * defaulting to {@link DEFAULT_LANGUAGE} when nothing has provided one.
 * {@link useLanguage} is the write, and it needs the router because choosing a
 * language is navigation now.
 */

import { createContext, use } from 'react';

import { DEFAULT_LANGUAGE, type Language } from '../../domain/landing';

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

/** The language of the surrounding subtree. Portuguese where none is set. */
export function useCurrentLanguage(): Language {
  return use(LanguageContext);
}
