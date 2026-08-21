/**
 * Writes a real HTML file for every address the site has, after `vite build`.
 *
 * ## The problem this solves
 *
 * `vite build` produces one `index.html` with an empty `#root`, and
 * `vercel.json` rewrites every route to it. So `/`, `/about` and `/watch/220`
 * served the same bytes: the same title, the same description, and no content
 * at all. Google renders pages before deciding, so it could eventually see the
 * app — but the render queue is slow and not guaranteed, and Bing, DuckDuckGo
 * and every link scraper (WhatsApp, Bluesky, Slack) never run JavaScript. To
 * all of them the archive did not exist and every link looked identical.
 *
 * This walks the same addresses and writes each one its own file, with its own
 * `<title>`, description, canonical, `hreflang` pair and social tags — and, for
 * an archive page, the text of the page itself in the markup.
 *
 * ## Why a build step and not a serverless function
 *
 * `api/` holds exactly twelve functions, which is the Hobby plan's cap — the
 * same wall `api/published.ts` describes. A thirteenth fails the deploy. Static
 * files avoid the question entirely, and Vercel checks the filesystem before
 * applying rewrites, so `dist/watch/220/index.html` is served at `/watch/220`
 * and the SPA catch-all never sees it.
 *
 * It also costs nothing at request time, which a function would, on a site
 * whose content changes when someone publishes rather than continuously.
 *
 * ## Where the content comes from, and what that means
 *
 * Two tables, unioned, because neither is complete on its own:
 *
 * - `live_pages` is the backup of the playhtml document — what visitors
 *   actually see, including pages people made by hand that were never
 *   published from the archive.
 * - `published_pages` is the record of which capture went to which number.
 *   Anything published since the last backup exists only here, so its cells are
 *   rebuilt from the capture the way `api/published.ts` builds them: the
 *   capture, optionally shifted down a row, optionally with a menu written over
 *   the last row.
 *
 * `live_pages` wins where both have a page, because it includes collaborative
 * edits made since publication and is therefore closer to what is on screen.
 *
 * **The backup is only as fresh as the last time someone pressed "Back up live
 * pages now" on `/manage`** — only a connected browser can read the Yjs
 * document, so neither the cron nor this script can refresh it. A stale backup
 * means the prerendered text lags what the page says. That is harmless for
 * search (the rendered app is still correct, and a crawler that renders sees
 * it) but it is worth knowing, so the age is printed on every build and warned
 * about past a week.
 *
 * ## Degrading
 *
 * With no `DATABASE_URL` — a contributor's checkout, a preview build without
 * the integration — this writes the static routes and stops. It never fails the
 * build: shipping a site whose archive pages are not prerendered is a worse
 * search result, while failing the build is no site at all.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isConfigured, db } from '../api/_lib/db';
import { LANGUAGES, type Language } from '../src/domain/landing';
import { applyMenu, type MenuItem } from '../src/domain/menu';
import { pageToArray } from '../src/domain/pageEncoding';
import { pageRows } from '../src/domain/pageSearch';
import { shiftPageDown } from '../src/domain/pageTransform';
import { localizePath } from '../src/domain/routes';
import {
  LOCALE,
  SITE_URL,
  headTags,
  pageMeta,
  pagePath,
  routeMeta,
  type Meta,
} from '../src/domain/seo';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

/** The routes with no data behind them, which exist at every deploy. */
const STATIC_PATHS = ['/', '/about', '/watch', '/edit', '/guestbook'];

/** Past this, the prerendered text is old enough to mention. */
const STALE_AFTER_DAYS = 7;

/** One address, ready to be written. */
interface Target {
  path: string;
  meta: Record<Language, Meta>;
  /** The page's rows, for the markup a non-rendering reader gets. */
  rows?: readonly string[];
  title?: string;
}

/** A page gathered from the database, whatever table it came from. */
interface SourcePage {
  pageNumber: number;
  subpage: number;
  title: string;
  description: string;
  rows: readonly string[];
}

async function loadPages(): Promise<{ pages: SourcePage[]; backupAge: number | null }> {
  if (!isConfigured()) {
    console.warn(
      '  ! DATABASE_URL is not set — writing the static routes only.\n' +
        '    The archive pages will not be prerendered in this build.',
    );
    return { pages: [], backupAge: null };
  }

  const sql = db();
  const byKey = new Map<string, SourcePage>();

  // Published first, so the live backup can overwrite it below.
  const published = await sql`
    select p.page_number, p.subpage, p.title, p.description,
           p.shift_down, p.menu_id, c.cells
    from published_pages p
    join archive_captures c on c.id = p.capture_id
    where c.cells is not null
  `;
  const menus = await sql`select id, items from custom_menus`;
  const menuById = new Map(menus.map((m) => [String(m.id), m.items as MenuItem[]]));

  for (const row of published) {
    // The same derivation `api/published.ts` performs when publishing: the
    // capture, then the transforms that were recorded with it.
    let page = pageToArray(row.cells);
    if (row.shift_down) page = shiftPageDown(page);
    const items = row.menu_id == null ? undefined : menuById.get(String(row.menu_id));
    if (items) page = applyMenu(page, { items });

    byKey.set(`${row.page_number}.${row.subpage}`, {
      pageNumber: row.page_number,
      subpage: row.subpage,
      title: row.title ?? '',
      description: row.description ?? '',
      rows: pageRows(page),
    });
  }

  const live = await sql`
    select page_number, subpage, title, description, cells from live_pages
  `;
  for (const row of live) {
    byKey.set(`${row.page_number}.${row.subpage}`, {
      pageNumber: row.page_number,
      subpage: row.subpage,
      title: row.title ?? '',
      description: row.description ?? '',
      rows: pageRows(row.cells),
    });
  }

  const [{ age }] = await sql`
    select extract(epoch from (now() - max(updated_at))) / 86400 as age
    from live_pages
  `;

  return {
    pages: [...byKey.values()].sort(
      (a, b) => a.pageNumber - b.pageNumber || a.subpage - b.subpage,
    ),
    backupAge: age == null ? null : Number(age),
  };
}

/** Both languages' URLs for one path, which is what `hreflang` needs. */
function alternates(path: string): Record<Language, string> {
  return Object.fromEntries(
    LANGUAGES.map((lang) => [lang, `${SITE_URL}${localizePath(path, lang)}`]),
  ) as Record<Language, string>;
}

/**
 * What a reader who never runs JavaScript is given in place of the app.
 *
 * It goes *inside* `#root`, which React empties on its first render — so a
 * browser shows this only for the moment before the bundle boots, and a crawler
 * that does not render keeps it. Putting the text somewhere React does not own
 * would leave it on screen underneath the television.
 *
 * Styled black on black-background monospace rather than left unstyled, because
 * that moment is visible: the site is black, and a flash of serif text on white
 * reads as a broken page where a teletext-ish block reads as one still loading.
 */
function fallbackBody(target: Target, language: Language): string {
  const meta = target.meta[language];
  const rows = (target.rows ?? []).filter((row) => row.trim().length > 0);

  const lines = rows.length
    ? `<pre style="margin:0;font:14px/1.35 monospace;white-space:pre-wrap">${rows
        .map((row) => escapeText(row))
        .join('\n')}</pre>`
    : '';

  return (
    `<div style="min-height:100vh;background:#000;color:#fff;` +
    `font-family:monospace;padding:2rem">` +
    `<h1 style="font-size:1.1rem;font-weight:normal">${escapeText(meta.title)}</h1>` +
    `<p style="color:#c8c8c8">${escapeText(meta.description)}</p>` +
    lines +
    `</div>`
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Where a path's file goes: `/watch/220` is `dist/watch/220/index.html`. */
function fileFor(path: string): string {
  return join(dist, path === '/' ? '' : path, 'index.html');
}

async function main(): Promise<void> {
  const template = await readFile(join(dist, 'index.html'), 'utf8');

  const markers = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
  if (!markers.test(template)) {
    throw new Error(
      'dist/index.html has no <!-- seo:start --> … <!-- seo:end --> region. ' +
        'The prerenderer replaces that region per URL; without it every page ' +
        'would silently keep the front page’s tags.',
    );
  }

  const { pages, backupAge } = await loadPages();

  const targets: Target[] = [
    ...STATIC_PATHS.map((path) => ({
      path,
      meta: Object.fromEntries(
        LANGUAGES.map((lang) => [lang, routeMeta(path, lang)]),
      ) as Record<Language, Meta>,
    })),
    ...pages.map((page) => ({
      path: pagePath(page.pageNumber, page.subpage),
      rows: page.rows,
      title: page.title,
      meta: Object.fromEntries(
        LANGUAGES.map((lang) => [lang, pageMeta(page, lang)]),
      ) as Record<Language, Meta>,
    })),
  ];

  let written = 0;
  for (const target of targets) {
    const alts = alternates(target.path);
    for (const language of LANGUAGES) {
      const html = template
        // The markers are put back, so running this twice over one `dist` is a
        // no-op rather than an error. `vite build` is what normally refreshes
        // the template, but the two are separate commands and nothing should
        // depend on the order they are run in.
        .replace(
          markers,
          `<!-- seo:start -->\n    ` +
            headTags(target.meta[language], language, alts) +
            `\n    <!-- seo:end -->`,
        )
        // A pattern rather than the literal `lang="pt"`, for the same reason.
        .replace(/<html lang="[^"]*"/, `<html lang="${LOCALE[language]}"`)
        .replace(
          /<div id="root">[\s\S]*?<\/div>|<div id="root"><\/div>/,
          `<div id="root">${fallbackBody(target, language)}</div>`,
        )
        // The note at the top of `index.html` explains the file to whoever
        // edits it. It is build-time documentation and there is no reason to
        // send it to every visitor, 162 times over.
        .replace(/^<!--[\s\S]*?-->\n/m, '');

      const file = fileFor(localizePath(target.path, language));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      written += 1;
    }
  }

  await writeSitemap(targets);

  console.log(
    `prerendered ${written} files — ${targets.length} addresses x ${LANGUAGES.length} languages\n` +
      `  ${STATIC_PATHS.length} static routes, ${pages.length} archive pages`,
  );
  if (backupAge != null) {
    const days = backupAge.toFixed(1);
    const stale = backupAge > STALE_AFTER_DAYS;
    console.log(
      `  live-page backup is ${days} days old` +
        (stale
          ? `\n  ! older than ${STALE_AFTER_DAYS} days. The prerendered text lags what` +
            `\n    visitors see. Press "Back up live pages now" on /manage — only a` +
            `\n    connected browser can read the playhtml document.`
          : ''),
    );
  }
}

/**
 * The sitemap, listing both languages of every address with `hreflang`
 * alternates.
 *
 * It replaces a hand-written file that listed five URLs and deliberately left
 * the archive out — because at the time every one of those URLs served the same
 * empty shell, and pointing a crawler at hundreds of identical documents is a
 * duplicate-content signal rather than a discovery. Now that each one is its own
 * document, listing them is the point.
 */
async function writeSitemap(targets: Target[]): Promise<void> {
  const urls = targets
    .flatMap((target) =>
      LANGUAGES.map((language) => {
        const alts = alternates(target.path);
        const links = LANGUAGES.map(
          (lang) =>
            `    <xhtml:link rel="alternate" hreflang="${LOCALE[lang]}" href="${alts[lang]}"/>`,
        ).join('\n');
        return (
          `  <url>\n` +
          `    <loc>${alts[language]}</loc>\n` +
          `${links}\n` +
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${alts.pt}"/>\n` +
          `  </url>`
        );
      }),
    )
    .join('\n');

  await writeFile(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!-- Generated by scripts/prerender.ts. Do not edit. -->\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
      `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      `${urls}\n` +
      `</urlset>\n`,
  );
}

await main();
