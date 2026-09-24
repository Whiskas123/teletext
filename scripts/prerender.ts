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
 * One table: `live_pages`, the database's copy of the playhtml document —
 * what visitors actually see, hand-made pages and archive pages alike, with
 * where each archive screen came from alongside it.
 *
 * It used to be unioned with `published_pages`, rebuilding cells from the
 * capture for anything published since the last manual backup. That table was
 * a second map of the service, and it drifted: records whose pages had been
 * emptied or moved came back here as pages that were not on the service. The
 * copy is now kept current by the live mirror (`src/collab/liveMirror.ts`), so
 * it is the only source needed.
 *
 * **The copy is only as fresh as the last moderator browser that was open** —
 * only a connected browser can read the Yjs document, so neither the cron nor
 * this script can refresh it. A stale copy
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
import { BOOT_DATA_PATH, BOOT_LIVE_PATH, bootPage, type BootData } from '../src/domain/bootData';
import { isPageKind } from '../src/domain/directory';
import { pageToArray } from '../src/domain/pageEncoding';
import { pageKey } from '../src/domain/subpages';
import type { TeletextPage } from '../src/types/teletext';
import { pageRows } from '../src/domain/pageSearch';
import { localizePath } from '../src/domain/routes';
import {
  SHOWCASE_BOOT_ID,
  SHOWCASE_DIR,
  showcasePicturePath,
  type ShowcaseBootEntry,
} from '../src/domain/showcase';
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
  cells: TeletextPage;
  /** The directory role, which only the live backup records. */
  kind?: string;
  /** How many screens the page holds, which only the live backup records. */
  subpageCount?: number;
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

  const live = await sql`
    select page_number, subpage, subpage_count, title, kind, description, cells
    from live_pages
  `;
  for (const row of live) {
    const cells = pageToArray(row.cells);
    byKey.set(`${row.page_number}.${row.subpage}`, {
      pageNumber: row.page_number,
      subpage: row.subpage,
      title: row.title ?? '',
      description: row.description ?? '',
      rows: pageRows(cells),
      cells,
      kind: row.kind ?? undefined,
      subpageCount: row.subpage_count ?? undefined,
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

/**
 * Every page, as one file the viewers draw from until playhtml has synced.
 *
 * See `src/domain/bootData.ts` for why. It is written from the same pages as
 * the prerendered HTML, so it is exactly as fresh — the backup age printed at
 * the end of the build is this file's age too.
 *
 * Titles, kinds and subpage counts go with the cells because the viewer needs
 * them to be usable rather than just visible: the Yellow Pages, the search, and
 * the `‹ 1/3 ›` of a carousel all read them.
 */
async function writeBootData(pages: readonly SourcePage[]): Promise<void> {
  const data: BootData = { pages: {}, 'subpage-counts': {}, titles: {}, 'page-kinds': {} };

  for (const page of pages) {
    data.pages[String(pageKey(page.pageNumber, page.subpage))] = bootPage(page.cells);

    // A page's own count where the backup has one; otherwise the highest
    // screen published, which is what the carousel was built to hold.
    const counts = data['subpage-counts'];
    const count = page.subpageCount ?? page.subpage;
    counts[page.pageNumber] = Math.max(counts[page.pageNumber] ?? 1, count);

    if (page.subpage === 1) {
      if (page.title !== '') data.titles[page.pageNumber] = page.title;
      if (isPageKind(page.kind)) data['page-kinds'][page.pageNumber] = page.kind;
    }
  }

  const json = JSON.stringify(data);
  const file = join(dist, BOOT_DATA_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, json);
  console.log(
    `  ${pages.length} pages written to dist${BOOT_DATA_PATH} — ` +
      `${(json.length / 1024).toFixed(0)} KB before compression`,
  );
}

/**
 * The front page's strip, written into `dist/` as files.
 *
 * ## Why the build does this at all
 *
 * The strip is the first thing on the front page and it was the last thing to
 * arrive: the bundle had to boot, `useShowcase` had to ask `/api/showcase` what
 * was on the strip — a function invocation and a database query, about half a
 * second — and only then did the `<img>`s exist for the browser to start
 * fetching. Three serial steps before the first picture was even requested.
 *
 * Everything needed is already known here, at build time, where this script is
 * holding an open connection to the same table. So it writes the pictures out
 * as ordinary files and lists them in the landing page's own HTML. The browser
 * finds them with its preload scanner, while the bundle is still downloading,
 * and fetches them from the CDN rather than from a function.
 *
 * ## Why they are re-encoded
 *
 * A moderator's browser draws the page on a canvas and `toBlob` hands back a
 * full-colour RGBA PNG — about 22 KB for something that is flat colour and hard
 * edges. As an indexed PNG the same picture is about 5 KB, and the difference
 * is invisible: a teletext page is eight colours and the rest is the
 * antialiasing on the glyph edges. Twenty pages is the difference between
 * ~450 KB and ~110 KB, which is the difference between the strip arriving and
 * the strip appearing.
 *
 * `sharp` does the encoding and is a *dev* dependency — it is not wanted in any
 * function. If it cannot be loaded, the stored bytes are written unchanged and
 * the build says so: a heavier front page is worth shipping, a broken one is
 * not.
 */
async function writeShowcase(): Promise<ShowcaseBootEntry[]> {
  if (!isConfigured()) return [];

  const rows = await db()`
    select page_number, subpage, position, title, image, image_type, updated_at
    from showcase_pages
    order by position, page_number, subpage
  `;
  if (rows.length === 0) return [];

  // Optional, and deliberately so — see above.
  let encode: ((bytes: Buffer) => Promise<Buffer>) | null = null;
  try {
    const { default: sharp } = await import('sharp');
    encode = (bytes) =>
      sharp(bytes)
        // 16, not 8: the glyph edges are antialiased, so the page holds a few
        // hundred distinct colours even though it is drawn from eight. At 16 it
        // is indistinguishable from the original; at 8 the lettering thins.
        .png({ palette: true, colours: 16, effort: 10, compressionLevel: 9 })
        .toBuffer();
  } catch {
    console.warn(
      '  ! sharp could not be loaded — the front page pictures are written as\n' +
        '    stored, about four times larger than they need to be.',
    );
  }

  const entries: ShowcaseBootEntry[] = [];
  let stored = 0;
  let written = 0;

  for (const row of rows) {
    // Neon returns `bytea` as a `\x…` hex string over the HTTP driver, the same
    // way `api/showcase.ts` receives it.
    const raw: unknown = row.image;
    if (raw == null) continue;
    const original = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(String(raw).replace(/^\\x/, ''), 'hex');
    if (original.length === 0) continue;

    // Re-encoding is an optimisation, never a reason to lose a picture: a page
    // sharp chokes on is written as it was rather than dropped off the strip.
    let bytes = original;
    if (encode != null) {
      try {
        const smaller = await encode(original);
        if (smaller.length > 0 && smaller.length < original.length) bytes = smaller;
      } catch (error) {
        console.warn(
          `  ! page ${row.page_number}-${row.subpage}: could not re-encode ` +
            `(${error instanceof Error ? error.message : String(error)}) — ` +
            'written as stored.',
        );
      }
    }

    const updatedAt = new Date(row.updated_at).toISOString();
    const src = showcasePicturePath(
      Number(row.page_number),
      Number(row.subpage),
      updatedAt,
      // Whatever it is now, it is a PNG if it went through sharp.
      bytes === original && String(row.image_type ?? '').includes('gif') ? 'gif' : 'png',
    );

    const file = join(dist, src);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);

    entries.push({
      page_number: Number(row.page_number),
      subpage: Number(row.subpage),
      position: Number(row.position),
      title: row.title ?? '',
      updated_at: updatedAt,
      src,
    });
    stored += original.length;
    written += bytes.length;
  }

  console.log(
    `  ${entries.length} front-page pictures written to dist/${SHOWCASE_DIR}/ — ` +
      `${(written / 1024).toFixed(0)} KB` +
      (written < stored ? ` (${(stored / 1024).toFixed(0)} KB as stored)` : ''),
  );

  return entries;
}

/**
 * The strip, as the landing page's own HTML carries it.
 *
 * Two things, and they are for two different readers. The `preload` links are
 * for the browser's preload scanner, which reads the raw bytes of `<head>`
 * before any script has run and starts the pictures then — the whole point of
 * the exercise. The JSON block is for `useShowcase`, so its first render has
 * the strip rather than an empty band that fills in after a round trip.
 *
 * Only the two landing addresses get it. Everywhere else it would be twenty
 * fetches for a strip that page does not have.
 */
function showcaseHead(entries: readonly ShowcaseBootEntry[]): string {
  if (entries.length === 0) return '';

  const links = entries
    .map((entry) => `<link rel="preload" as="image" href="${entry.src}" />`)
    .join('\n    ');

  // `<` escaped, so a title holding `</script>` cannot end the block early.
  const json = JSON.stringify(entries).replace(/</g, '\\u003c');

  return (
    `\n    ${links}` +
    `\n    <script type="application/json" id="${SHOWCASE_BOOT_ID}">${json}</script>`
  );
}

/**
 * Whether an address opens on the television, and so wants the pages file.
 *
 * Only those: the front page does not draw pages, and a preload the page never
 * uses is a download the browser warns about.
 */
function isWatchPath(path: string): boolean {
  return path === '/watch' || path.startsWith('/watch/');
}

/**
 * Starts the pages file from `<head>`, so it downloads alongside the bundle
 * rather than after it. The live copy, which the app asks for first; the
 * build's own file is fetched only if that fails, so it is not preloaded. `crossorigin` is what a plain `fetch()` asks with, and
 * without it the browser fetches the file twice.
 */
function bootDataHead(): string {
  return `\n    <link rel="preload" as="fetch" crossorigin="anonymous" href="${BOOT_LIVE_PATH}" />`;
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
  const showcase = await writeShowcase();
  if (pages.length > 0) await writeBootData(pages);

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
        // The strip, for the front page only — the pictures to start fetching
        // and the list to draw them from. See {@link showcaseHead}.
        .replace(
          '</head>',
          `${target.path === '/' ? showcaseHead(showcase) : ''}` +
            `${pages.length > 0 && isWatchPath(target.path) ? bootDataHead() : ''}\n  </head>`,
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
