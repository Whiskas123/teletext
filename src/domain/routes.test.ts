// Feature: where each language lives, as URLs.
// Verifies: the spellings by hand, and then the two properties the switch
// depends on — that localising a path and reading it back is a round trip, and
// that switching language twice lands exactly where it started. The second is
// the one that would break silently: a switch that drifts by a slash each time
// looks fine on the first click.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { LANGUAGES } from './landing';
import { localizePath, readLanguagePath, switchLanguagePath } from './routes';

/** Paths as they appear in the router: a leading slash, no prefix. */
const path = () =>
  fc
    .array(
      fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,12}$/).filter((s) => s !== 'en'),
      { maxLength: 4 },
    )
    .map((segments) => `/${segments.join('/')}`.replace(/\/+$/, '') || '/');

const language = () => fc.constantFrom(...LANGUAGES);

describe('localizePath', () => {
  it('leaves Portuguese bare, so every link that already exists still works', () => {
    expect(localizePath('/', 'pt')).toBe('/');
    expect(localizePath('/about', 'pt')).toBe('/about');
    expect(localizePath('/watch/220', 'pt')).toBe('/watch/220');
  });

  it('puts English under /en, with the front page as /en and not /en/', () => {
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('/about', 'en')).toBe('/en/about');
    expect(localizePath('/watch/220', 'en')).toBe('/en/watch/220');
  });
});

describe('readLanguagePath', () => {
  it('reads the prefix back off', () => {
    expect(readLanguagePath('/en')).toEqual({ language: 'en', path: '/' });
    expect(readLanguagePath('/en/')).toEqual({ language: 'en', path: '/' });
    expect(readLanguagePath('/en/about')).toEqual({
      language: 'en',
      path: '/about',
    });
  });

  it('treats an unprefixed path as Portuguese', () => {
    expect(readLanguagePath('/')).toEqual({ language: 'pt', path: '/' });
    expect(readLanguagePath('/about')).toEqual({ language: 'pt', path: '/about' });
  });

  // The reason the prefix is matched on a segment boundary rather than with
  // `startsWith`. A page called `english` is not the English site, and reading
  // it as one would eat the first segment of a real path.
  it('does not mistake a path that merely begins with the letters', () => {
    expect(readLanguagePath('/english')).toEqual({
      language: 'pt',
      path: '/english',
    });
    expect(readLanguagePath('/entrada')).toEqual({
      language: 'pt',
      path: '/entrada',
    });
  });
});

describe('the properties the switch rests on', () => {
  it('localising and reading back is a round trip', () => {
    fc.assert(
      fc.property(path(), language(), (p, lang) => {
        expect(readLanguagePath(localizePath(p, lang))).toEqual({
          language: lang,
          path: p,
        });
      }),
    );
  });

  it('switching to the other language and back returns the same address', () => {
    fc.assert(
      fc.property(path(), language(), language(), (p, from, to) => {
        const there = switchLanguagePath(localizePath(p, from), to);
        expect(switchLanguagePath(there, from)).toBe(localizePath(p, from));
      }),
    );
  });
});
