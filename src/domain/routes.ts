/**
 * Where each language lives, as URLs.
 *
 * The front page's switch used to change a `localStorage` key and nothing else,
 * which meant the two languages shared one address. That is invisible to
 * everything that does not run JavaScript: a crawler, and every scraper that
 * builds a link card, fetches a URL cold — no storage, no cookies — so one URL
 * could only ever have one title and one description, whichever language it was
 * written in. It is also what Google asks you not to do, for the same reason:
 * only one version can be indexed, and which one is arbitrary.
 *
 * So the language is part of the path now.
 *
 * ## Why Portuguese is the one without a prefix
 *
 * Two reasons, and the second is the one that decided it.
 *
 * Portuguese is {@link DEFAULT_LANGUAGE} — the archive is Portuguese and so are
 * the people most likely to want it — so the plain address should be the one
 * most readers want.
 *
 * And the site is already live. Every link to it that exists, anywhere, is
 * unprefixed. Giving Portuguese a `/pt` prefix would break all of them at once,
 * or require a redirect for every route forever; leaving it bare means the new
 * URLs are purely additive and nothing that already works stops working.
 *
 * ## What this is not
 *
 * It is not a second copy of the site. playhtml scopes its document by hostname
 * and the room name `GlobalProvider` pins, never by path — so `/en/watch/220`
 * and `/watch/220` are the same page, the same cells, the same live document.
 * Someone editing in English and someone watching in Portuguese see each other
 * keystroke by keystroke. Only a different *hostname* forks the document, which
 * is what the README's "One domain per library" is about.
 */

import { LANGUAGES, type Language } from './landing';

/** What each language puts in front of a path. Portuguese adds nothing. */
export const LANGUAGE_PREFIX: Record<Language, string> = {
  pt: '',
  en: '/en',
};

/**
 * The language a pathname is in, and the path *within* that language.
 *
 * The returned `path` always begins with `/` and never carries the prefix, so
 * it can be handed straight to {@link localizePath} for the other language —
 * which is all the switch has to do.
 */
export function readLanguagePath(pathname: string): {
  language: Language;
  path: string;
} {
  for (const language of LANGUAGES) {
    const prefix = LANGUAGE_PREFIX[language];
    if (prefix === '') continue;

    // Matched on a segment boundary, not as a string prefix: `/english` starts
    // with `/en` and is not English, and treating it as such would swallow the
    // first segment of a real path.
    if (pathname === prefix) return { language, path: '/' };
    if (pathname.startsWith(`${prefix}/`)) {
      return { language, path: pathname.slice(prefix.length) || '/' };
    }
  }

  return { language: 'pt', path: pathname || '/' };
}

/**
 * `path` — a language-independent path with a leading slash — addressed in
 * `language`.
 *
 * Idempotent in the sense that matters: it takes the *unprefixed* path, so
 * localising an already-localised path is a bug at the call site rather than
 * something this quietly doubles. {@link readLanguagePath} is how you get one.
 */
export function localizePath(path: string, language: Language): string {
  const prefix = LANGUAGE_PREFIX[language];
  if (prefix === '') return path;
  // `/` under a prefix is the prefix itself: `/en`, not `/en/`, so that the
  // canonical form of the English front page has one spelling.
  return path === '/' ? prefix : `${prefix}${path}`;
}

/** The same address in the other language, given a full pathname. */
export function switchLanguagePath(pathname: string, to: Language): string {
  return localizePath(readLanguagePath(pathname).path, to);
}
