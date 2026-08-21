// Feature: what each URL says about itself, for readers that never render it.
// Verifies: that a description is cut at a word and never exceeds what Google
// will show, that a page's description is built from what the page says with
// the header row dropped, that a titled page leads with its title and an
// untitled one still says something, and that the canonical URLs differ by
// language — which is the whole reason the language moved into the path.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DESCRIPTION_MAX,
  SITE_META,
  canonicalUrl,
  describePage,
  headTags,
  pageMeta,
  pagePath,
  routeMeta,
  truncate,
} from './seo';

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Meteorologia')).toBe('Meteorologia');
  });

  it('cuts at a word boundary and marks the cut', () => {
    const out = truncate('a'.repeat(10) + ' ' + 'b'.repeat(200), 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('aaaaaaaaaa…');
  });

  it('collapses the runs of blanks a teletext page is padded with', () => {
    expect(truncate('NOTICIAS     NACIONAIS')).toBe('NOTICIAS NACIONAIS');
  });

  it('never exceeds the budget, whatever it is given', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 8, max: 300 }), (text, max) => {
        expect(truncate(text, max).length).toBeLessThanOrEqual(max);
      }),
    );
  });
});

describe('describePage', () => {
  // Row 0 is the teletext header: page number, service, date. It is the same on
  // every page and is already in the title, so it is not a description.
  it('drops the header row', () => {
    const rows = ['220 RTP TEXTO 12 MAR', 'METEOROLOGIA', 'Lisboa 18 graus'];
    expect(describePage(rows)).toBe('METEOROLOGIA · Lisboa 18 graus');
  });

  it('drops the blank rows a page is mostly made of', () => {
    const rows = ['header', '', 'DESPORTO', '', '', 'Benfica 2 Porto 1', ''];
    expect(describePage(rows)).toBe('DESPORTO · Benfica 2 Porto 1');
  });

  it('is empty when the page has nothing on it', () => {
    expect(describePage(['header', '', '', ''])).toBe('');
  });

  it('never exceeds what a search result will show', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 24 }), (rows) => {
        expect(describePage(rows).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }),
    );
  });
});

describe('pageMeta', () => {
  const rows = ['220 RTP TEXTO', 'METEOROLOGIA', 'Lisboa 18 graus'];

  it('leads with the page title, because that is what is searched for', () => {
    const meta = pageMeta({ pageNumber: 220, title: 'Meteorologia', rows }, 'pt');
    expect(meta.title).toBe('Meteorologia — página 220 — Tele-textual');
  });

  it('still names an untitled page rather than showing a bare number', () => {
    const meta = pageMeta({ pageNumber: 220, rows }, 'pt');
    expect(meta.title).toBe('Página sem título — página 220 — Tele-textual');
    expect(pageMeta({ pageNumber: 220, rows }, 'en').title).toBe(
      'Untitled page — page 220 — Tele-textual',
    );
  });

  it('names the screen when the hit is on a later one of a carousel', () => {
    const meta = pageMeta({ pageNumber: 220, subpage: 3, title: 'Desporto' }, 'pt');
    expect(meta.title).toBe('Desporto — página 220, ecrã 3 — Tele-textual');
    expect(meta.canonical).toBe('https://teletext.joaobernardo.me/watch/220/3');
  });

  it('prefers the page’s own description over the text scraped off it', () => {
    const meta = pageMeta(
      { pageNumber: 220, title: 'Meteorologia', description: 'O tempo.', rows },
      'pt',
    );
    expect(meta.description).toBe('O tempo.');
  });

  it('falls back to the site description when the page is blank', () => {
    const meta = pageMeta({ pageNumber: 700, rows: ['header', '', ''] }, 'pt');
    expect(meta.description).toBe(SITE_META.pt.description);
  });
});

describe('the addresses', () => {
  it('puts a subpage in the path only when there is one', () => {
    expect(pagePath(220)).toBe('/watch/220');
    expect(pagePath(220, 1)).toBe('/watch/220');
    expect(pagePath(220, 2)).toBe('/watch/220/2');
  });

  // The point of the whole exercise: two languages, two URLs, so each can
  // carry its own title instead of sharing one.
  it('gives each language its own canonical URL', () => {
    expect(canonicalUrl('/about', 'pt')).toBe(
      'https://teletext.joaobernardo.me/about',
    );
    expect(canonicalUrl('/about', 'en')).toBe(
      'https://teletext.joaobernardo.me/en/about',
    );
    expect(canonicalUrl('/', 'en')).toBe('https://teletext.joaobernardo.me/en');
  });

  it('names the static routes differently in each language', () => {
    expect(routeMeta('/about', 'pt').title).not.toBe(
      routeMeta('/about', 'en').title,
    );
    expect(routeMeta('/', 'pt').title).toBe(SITE_META.pt.title);
  });

  // Every route keeps its own title — two URLs sharing one is a duplicate
  // signal — while the description is written only for the front page and
  // inherited everywhere else. See the note on ROUTE_META.
  it('keeps a route’s own title while letting its description fall back', () => {
    for (const path of ['/about', '/watch', '/edit', '/guestbook']) {
      const meta = routeMeta(path, 'pt');
      expect(meta.title).not.toBe(SITE_META.pt.title);
      expect(meta.description).toBe(SITE_META.pt.description);
    }
  });

  it('describes the front page in its own words, in both languages', () => {
    expect(routeMeta('/', 'pt').description).toBe(SITE_META.pt.description);
    expect(routeMeta('/', 'en').description).toBe(SITE_META.en.description);
    expect(SITE_META.pt.description).not.toBe(SITE_META.en.description);
  });

  it('falls back to the site meta for a route it has no copy for', () => {
    expect(routeMeta('/nowhere', 'pt').title).toBe(SITE_META.pt.title);
  });
});

describe('headTags', () => {
  const alternates = {
    pt: 'https://teletext.joaobernardo.me/watch/220',
    en: 'https://teletext.joaobernardo.me/en/watch/220',
  };

  // Titles are typed by hand in /manage and descriptions are scraped off
  // archived cells. Both land inside content="…" in a file served to everyone.
  it('escapes a quote in a title instead of ending the attribute', () => {
    const meta = pageMeta({ pageNumber: 220, title: 'A "grande" noite' }, 'pt');
    const html = headTags(meta, 'pt', alternates);

    // Every attribute carrying the title has the quote neutralised...
    for (const tag of ['og:title', 'twitter:title']) {
      expect(html).toContain(`"${tag}" content="A &quot;grande&quot; noite`);
    }
    // ...while `<title>` is text content, where a bare quote is harmless and
    // escaping it would show `&quot;` to the reader.
    expect(html).toContain('<title>A "grande" noite —');
  });

  it('escapes angle brackets, so a title cannot open a tag', () => {
    const meta = pageMeta({ pageNumber: 220, title: '<script>x</script>' }, 'pt');
    const html = headTags(meta, 'pt', alternates);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lists every language, itself included — hreflang is ignored otherwise', () => {
    const html = headTags(pageMeta({ pageNumber: 220 }, 'en'), 'en', alternates);

    expect(html).toContain(`hreflang="pt-PT" href="${alternates.pt}"`);
    expect(html).toContain(`hreflang="en-GB" href="${alternates.en}"`);
    expect(html).toContain(`hreflang="x-default" href="${alternates.pt}"`);
  });

  it('states its own locale and names the other as the alternate', () => {
    const html = headTags(pageMeta({ pageNumber: 220 }, 'en'), 'en', alternates);

    expect(html).toContain('property="og:locale" content="en_GB"');
    expect(html).toContain('property="og:locale:alternate" content="pt_PT"');
  });
});
