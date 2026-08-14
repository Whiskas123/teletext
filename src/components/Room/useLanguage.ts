/**
 * The visitor's chosen language, remembered between visits.
 *
 * Kept in `localStorage` rather than `sessionStorage`, unlike the session member
 * id: which language you read in is a fact about you, not about this tab, and
 * having to re-pick it on every visit is exactly the kind of small insult that
 * makes a toggle feel broken.
 *
 * The rules for what counts as a language live in `domain/landing.ts`; this only
 * binds them to React and to storage. Storage access is wrapped because it
 * throws outright in a private window in some browsers — a language preference
 * is not worth a blank page, so it degrades to "this tab only".
 */

import { useCallback, useState } from 'react';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  otherLanguage,
  type Language,
} from '../../domain/landing';

/** Access `localStorage`, or `undefined` where it is unavailable. */
function storage(): Storage | undefined {
  try {
    return typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored preference, or the default when there is none to read. */
function storedLanguage(): Language {
  try {
    return normalizeLanguage(storage()?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export interface LanguageApi {
  language: Language;
  /** The one it is not, which is the only thing a two-sided toggle offers. */
  other: Language;
  setLanguage(next: Language): void;
  toggle(): void;
}

export function useLanguage(): LanguageApi {
  // Read once, lazily: reading storage on every render would be a synchronous
  // disk hit for a value that only this hook changes.
  const [language, setLanguageState] = useState<Language>(storedLanguage);

  const setLanguage = useCallback((next: Language) => {
    const value = normalizeLanguage(next);
    setLanguageState(value);
    try {
      storage()?.setItem(LANGUAGE_STORAGE_KEY, value);
    } catch {
      // Kept for this tab regardless: the state above has already changed, so a
      // storage that refuses to write costs the visitor their next visit, not
      // this one.
    }
  }, []);

  const toggle = useCallback(() => {
    setLanguageState((current) => {
      const next = otherLanguage(current);
      try {
        storage()?.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        /* as above */
      }
      return next;
    });
  }, []);

  return { language, other: otherLanguage(language), setLanguage, toggle };
}
