/**
 * What each URL says about itself: its title, its description, its canonical
 * address and the other language's.
 *
 * Pure and framework-free, because two very different things read it. The
 * prerenderer (`scripts/prerender.ts`) calls it at build time to write the tags
 * into static HTML, which is the copy that crawlers and link scrapers see; the
 * app could call the same functions to keep `document.title` right as the
 * visitor moves around. One source, so the two cannot disagree.
 *
 * ## Why the copy lives here and not in `index.html`
 *
 * It was in `index.html`, three times over — plain, `og:` and `twitter:` — and
 * that is exactly as fragile as it sounds. Editing one of the three left the
 * link card and the search result saying different things, silently, in the one
 * file with no test over it. Here the description is written once and the three
 * tags are generated from it.
 *
 * ## Why it is not in `copy.ts`
 *
 * `copy.ts` is what the app says to a visitor who is looking at it. This is
 * what the site says about itself to a machine that is not rendering it. They
 * are read at different times by different readers, and only this one has to be
 * available in a Node script with no DOM.
 */

import type { Language } from './landing';
import { localizePath } from './routes';

/** The canonical origin. Absolute URLs are required: a scraper has left. */
export const SITE_URL = 'https://teletext.joaobernardo.me';

/** The social image, 1200x630 — see `scripts/makeOgImage.ts`. */
export const OG_IMAGE = `${SITE_URL}/og.png`;

/** What a page's tags come out as. */
export interface Meta {
  title: string;
  description: string;
  /** Absolute, for `<link rel="canonical">` and `og:url`. */
  canonical: string;
}

/** The site's own name, the same in both languages. */
export const SITE_NAME = 'Tele-textual';

/** BCP-47 tags, for `hreflang` and `og:locale`. */
export const LOCALE: Record<Language, string> = {
  pt: 'pt-PT',
  en: 'en-GB',
};

/**
 * The front page's title and description, per language.
 *
 * The broadcasters are deliberately not named — see the README under "Being
 * found" for what that costs and why it was chosen. `arquivo vivo` is the
 * phrase for the site in Portuguese; `living archive` carries it in English.
 */
export const SITE_META: Record<Language, { title: string; description: string }> = {
  pt: {
    title: `${SITE_NAME} — arquivo vivo de teletexto português`,
    description:
      'Um arquivo vivo do teletexto português. Vê páginas sozinho ou numa ' +
      'sala com outras pessoas, e cria as tuas próprias.',
  },
  en: {
    title: `${SITE_NAME} — a living archive of Portuguese teletext`,
    description:
      'A living archive of Portuguese teletext. Watch pages on your own or ' +
      'in a room with other people, and make your own.',
  },
};

/** The words each language uses for the things the titles are made of. */
const WORDS: Record<Language, { page: string; screen: string; untitled: string }> = {
  pt: { page: 'página', screen: 'ecrã', untitled: 'Página sem título' },
  en: { page: 'page', screen: 'screen', untitled: 'Untitled page' },
};

/**
 * The static routes, and what each one is called.
 *
 * ## Why a title but no description
 *
 * The description is optional here, and only the front page has one — it is in
 * {@link SITE_META}, since the front page *is* the site. Everything else falls
 * back to it.
 *
 * The two are not equally worth writing. A title is what distinguishes one URL
 * from another in a result list, and two pages sharing one is a genuine
 * duplicate signal — so every route keeps its own. A description is not a
 * ranking factor at all; it decides whether someone clicks, and Google discards
 * it and writes its own snippet from the page whenever the query is served
 * better that way.
 *
 * What it is never discarded for is a **link card** — WhatsApp, Bluesky and
 * Slack print `og:description` verbatim. But the routes below are screens you
 * arrive at by clicking rather than pages anyone links to; the front page is
 * what gets shared, and the archive pages describe themselves out of their own
 * text (see {@link describePage}). Writing four more would be four more strings
 * to keep true for no reader.
 *
 * Adding one is adding the line back. The fallback is a default, not a ceiling.
 */
export const ROUTE_META: Record<
  string,
  Record<Language, { title: string; description?: string }>
> = {
  '/about': {
    pt: { title: `Sobre — ${SITE_NAME}` },
    en: { title: `About — ${SITE_NAME}` },
  },
  '/watch': {
    pt: { title: `Ver teletexto — ${SITE_NAME}` },
    en: { title: `Watch teletext — ${SITE_NAME}` },
  },
  '/edit': {
    pt: { title: `Criar uma página — ${SITE_NAME}` },
    en: { title: `Make a page — ${SITE_NAME}` },
  },
  '/guestbook': {
    pt: { title: `Guestbook — ${SITE_NAME}` },
    en: { title: `Guestbook — ${SITE_NAME}` },
  },
};

/** Google stops showing a description at roughly this many characters. */
export const DESCRIPTION_MAX = 155;

/**
 * Cut `text` to at most `max` characters without splitting a word.
 *
 * Falls back to a hard cut only when the first word is itself longer than the
 * budget, which on a teletext page means a run of punctuation rather than a
 * word — better truncated than allowed to blow the length.
 */
export function truncate(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;

  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:·\-–—]+$/, '')}…`;
}

/**
 * A description built out of what the page actually says.
 *
 * `rows` is {@link pageRows}' output: one entry per row, blanks included so row
 * numbers line up. The first row is dropped — on a teletext page that is the
 * header, carrying the page number, the service name and the date, which is
 * both identical across pages and already in the title.
 *
 * Rows are joined with a middle dot rather than a space because they are not
 * sentences: teletext lays a page out in columns and captions, so running the
 * rows together produces a phrase that reads as broken grammar, while a
 * separator makes it read as the list of headings it is.
 */
export function describePage(rows: readonly string[]): string {
  return truncate(
    rows
      .slice(1)
      .map((row) => row.trim())
      .filter((row) => row.length > 1)
      .join(' · '),
  );
}

/** What one archive page's URL says about itself. */
export interface PageMetaInput {
  pageNumber: number;
  /** Screen of the carousel; 1, or absent, is the page itself. */
  subpage?: number;
  /** The page's own title, as set in `/manage`. May be empty. */
  title?: string;
  /** The page's own description, if it has been given one. */
  description?: string;
  /** Every row of the page as text — {@link pageRows}. */
  rows?: readonly string[];
}

/** The path a page is addressed at, before any language prefix. */
export function pagePath(pageNumber: number, subpage = 1): string {
  return subpage > 1
    ? `/watch/${pageNumber}/${subpage}`
    : `/watch/${pageNumber}`;
}

/**
 * The tags for one archive page.
 *
 * The page's own title leads, because that is the part anyone is searching for
 * — the number is an address, not a name, and a results page of "Página 220",
 * "Página 221" tells a reader nothing. The number still appears, because it is
 * how this archive is navigated and someone may well be looking for it.
 */
export function pageMeta(page: PageMetaInput, language: Language): Meta {
  const words = WORDS[language];
  const subpage = page.subpage ?? 1;

  const name = page.title?.trim() || words.untitled;
  const address =
    subpage > 1
      ? `${words.page} ${page.pageNumber}, ${words.screen} ${subpage}`
      : `${words.page} ${page.pageNumber}`;

  const description =
    page.description?.trim() ||
    (page.rows ? describePage(page.rows) : '') ||
    SITE_META[language].description;

  return {
    title: `${name} — ${address} — ${SITE_NAME}`,
    description,
    canonical: canonicalUrl(pagePath(page.pageNumber, subpage), language),
  };
}

/** The absolute URL of `path` in `language`. */
export function canonicalUrl(path: string, language: Language): string {
  return `${SITE_URL}${localizePath(path, language)}`;
}

/** The tags for one of the static routes, or the front page. */
export function routeMeta(path: string, language: Language): Meta {
  const copy = path === '/' ? SITE_META[language] : ROUTE_META[path]?.[language];
  const fallback = SITE_META[language];
  return {
    title: copy?.title ?? fallback.title,
    description: copy?.description ?? fallback.description,
    canonical: canonicalUrl(path, language),
  };
}

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 *
 * Not optional here, and not a formality. Page titles are typed by hand in
 * `/manage`, and descriptions are scraped off the cells of archived pages —
 * both end up inside `content="…"` in a file that is served to everyone. A
 * single `"` in a title would close the attribute early, and everything after
 * it would be parsed as markup.
 */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a value for use as HTML text, as inside `<title>`. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Every tag that varies by URL, as the HTML that replaces the marked region of
 * `index.html`.
 *
 * `alternates` is the same path in every language, which is what `hreflang`
 * wants: each version must list all of them, itself included, or search engines
 * treat the cluster as unconfirmed and ignore it. `x-default` names the one to
 * show a reader whose language matches none — Portuguese, as everywhere else.
 */
export function headTags(
  meta: Meta,
  language: Language,
  alternates: Record<Language, string>,
): string {
  const title = escapeText(meta.title);
  const attr = escapeAttribute;
  const other = language === 'pt' ? 'en' : 'pt';

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${attr(meta.description)}" />`,
    `<link rel="canonical" href="${attr(meta.canonical)}" />`,
    ...Object.entries(alternates).map(
      ([lang, href]) =>
        `<link rel="alternate" hreflang="${LOCALE[lang as Language]}" href="${attr(href)}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${attr(alternates.pt)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:url" content="${attr(meta.canonical)}" />`,
    `<meta property="og:title" content="${attr(meta.title)}" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="${LOCALE[language].replace('-', '_')}" />`,
    `<meta property="og:locale:alternate" content="${LOCALE[other].replace('-', '_')}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(meta.title)}" />`,
    `<meta name="twitter:description" content="${attr(meta.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ].join('\n    ');
}
