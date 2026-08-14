/**
 * The front page's menu, and the two languages it speaks.
 *
 * A teletext service opened on a coloured index: four words down the left, each
 * in one of the palette's colours, each a way in. That is what the front page
 * is — so the menu is data rather than markup, and the colour is part of the
 * entry rather than a class name chosen at the call site. Adding a fifth way in
 * is a line here.
 *
 * Pure and framework-free, so the copy, the colours and the fallback rules are
 * testable without rendering anything.
 */

import type { TeletextColor } from '../types/teletext';

/** The languages the front page is written in. Portuguese is the default. */
export const LANGUAGES = ['pt', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * The language a visitor gets before they have chosen one.
 *
 * Portuguese, because the archive is: ~3,150 captures of RTP and SIC teletext,
 * in Portuguese, and the people most likely to want them are reading it.
 */
export const DEFAULT_LANGUAGE: Language = 'pt';

/** Where the visitor's choice is kept, so it survives leaving and coming back. */
export const LANGUAGE_STORAGE_KEY = 'teletext:language';

/** Whether `value` is one of the languages the front page speaks. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Coerce anything — a stored string, a URL param, a stale value from an older
 * build — into a language, falling back to {@link DEFAULT_LANGUAGE}.
 */
export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/** The other language, for a toggle that only ever has two sides. */
export function otherLanguage(current: Language): Language {
  return current === 'pt' ? 'en' : 'pt';
}

/** What a menu entry does when it is chosen. */
export type MenuAction =
  /** Watch: opens the choice of watching alone or in one of the rooms. */
  | 'watch'
  /** Create: opens the editor on the first free playground page. */
  | 'create'
  /** Nothing yet — rendered, but with nowhere to go. */
  | 'pending';

/** One coloured way in. */
export interface MenuEntry {
  id: 'watch' | 'create' | 'suggest' | 'about';
  action: MenuAction;
  /** Palette colour, from the eight a teletext page had. */
  color: TeletextColor;
  /** The word itself, per language. */
  label: Record<Language, string>;
  /** What choosing it does, for the accessible name — the word alone is terse. */
  hint: Record<Language, string>;
}

/**
 * The menu, in display order.
 *
 * Red, green, yellow, cyan: the fastext strip's four colours, in the order a
 * set's four coloured buttons ran. Blue is absent for the same reason it was on
 * air — against a black page it is nearly unreadable.
 */
export const MENU: readonly MenuEntry[] = [
  {
    id: 'watch',
    action: 'watch',
    color: 'red',
    label: { pt: 'ver', en: 'watch' },
    hint: {
      pt: 'Ver teletexto, sozinho ou numa sala',
      en: 'Watch teletext, alone or in a room',
    },
  },
  {
    id: 'create',
    action: 'create',
    color: 'green',
    label: { pt: 'criar', en: 'create' },
    hint: { pt: 'Criar e editar páginas', en: 'Create and edit pages' },
  },
  {
    id: 'suggest',
    action: 'pending',
    color: 'yellow',
    label: { pt: 'sugerir', en: 'suggest' },
    hint: { pt: 'Sugerir uma página', en: 'Suggest a page' },
  },
  {
    id: 'about',
    action: 'pending',
    color: 'cyan',
    label: { pt: 'sobre', en: 'about' },
    hint: { pt: 'Sobre o projeto', en: 'About the project' },
  },
] as const;

/** Everything else the front page says, per language. */
export const LANDING_COPY: Record<
  Language,
  {
    /**
     * One line under the wordmark saying what this is.
     *
     * Under the name rather than in the middle of the page: it is an apposition
     * to the wordmark, not a paragraph, and putting it in the empty band would
     * make it compete with the four coloured words for the same attention.
     */
    tagline: string;
    /** Read to screen readers in place of the logo. */
    logoAlt: string;
    /** Names the language switch itself. */
    languageSwitch: string;
    /** Names the menu region. */
    menu: string;
    /** Said of an entry that is rendered but has nowhere to go yet. */
    comingSoon: string;
    /** The watch submenu, revealed under "ver". */
    watchAlone: string;
    watchTogether: string;
    watching: string;
    empty: string;
    /** Names the showcase region, and its control. */
    onAir: string;
    /** The word before a page number, e.g. `página 220`. */
    pageWord: string;
  }
> = {
  pt: {
    tagline: ' ',
    logoAlt: 'Tele-textual',
    languageSwitch: 'Idioma',
    menu: 'Menu',
    comingSoon: 'em breve',
    watchAlone: 'sozinho',
    watchTogether: 'numa sala',
    watching: 'a ver',
    empty: 'vazia',
    onAir: 'No ar agora',
    pageWord: 'página',
  },
  en: {
    tagline: '',
    logoAlt: 'Tele-textual',
    languageSwitch: 'Language',
    menu: 'Menu',
    comingSoon: 'coming soon',
    watchAlone: 'on your own',
    watchTogether: 'in a room',
    watching: 'watching',
    empty: 'empty',
    onAir: 'On air now',
    pageWord: 'page',
  },
};

/** The project's name, which is the same in both languages. */
export const PROJECT_NAME = 'Tele-textual';

/**
 * The name split for display: it is set over two lines, and the break is part
 * of the wordmark rather than whatever the viewport happens to allow.
 */
export const PROJECT_NAME_LINES = ['Tele-', 'textual'] as const;
