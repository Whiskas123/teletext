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
  /** About: the one screen on the site that is prose. */
  | 'about'
  /** Guestbook: leave a name and eight rows of teletext. */
  | 'guestbook'
  /**
   * Nothing yet — rendered, but with nowhere to go.
   *
   * No entry uses this at the moment. It is kept because the menu is a list
   * that grows, and the alternative to a word that admits it does nothing yet
   * is a word that silently does nothing.
   */
  | 'pending';

/** One coloured way in. */
export interface MenuEntry {
  id: 'watch' | 'create' | 'guestbook' | 'about';
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
    id: 'guestbook',
    action: 'guestbook',
    color: 'yellow',
    // The same word in both languages. It is what the thing has been called
    // online since guestbooks existed, Portuguese included; `livro de visitas`
    // reads as a hotel reception rather than as this.
    label: { pt: 'guestbook', en: 'guestbook' },
    hint: { pt: 'Assinar o guestbook', en: 'Sign the guestbook' },
  },
  {
    id: 'about',
    action: 'about',
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
    /**
     * The watch submenu, revealed under "ver".
     *
     * Two kinds of thing, not seven doors: watching on your own, and watching
     * in one of the rooms with whoever else is in it. Each kind is named, and
     * the note under its name says what makes it that kind — six house names
     * on their own do not tell anyone there are other people behind them.
     */
    watchAlone: string;
    watchAloneNote: string;
    watchTogether: string;
    watchTogetherNote: string;
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
    watchAloneNote: 'só tu',
    watchTogether: 'numa sala',
    watchTogetherNote: 'com outras pessoas',
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
    watchAloneNote: 'just you',
    watchTogether: 'in a room',
    watchTogetherNote: 'with other people',
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
