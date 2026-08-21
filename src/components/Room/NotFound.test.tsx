// Feature: the screen for a URL that is not a route.
// Verifies: that an unknown address says so instead of silently becoming the
// front page, that it speaks the visitor's language like every other screen a
// visitor can reach, that it offers a way out, and — the part that is the whole
// reason it exists — that it tells search engines not to list it, and takes the
// tag away again when it unmounts so it cannot leak onto the next screen.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NotFound } from './NotFound';
import { LanguageProvider } from './LanguageProvider';
import { COPY } from '../../domain/copy';
import type { Language } from '../../domain/landing';

/**
 * The language is the address now, so a test states it the way the router
 * would rather than by writing a preference into storage.
 */
function renderNotFound(language: Language = 'pt') {
  return render(
    <MemoryRouter initialEntries={[language === 'en' ? '/en/nowhere' : '/nowhere']}>
      <LanguageProvider language={language}>
        <NotFound />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

/** The tag `useNoIndex` manages, read straight off the document. */
function robotsTag(): HTMLMetaElement | null {
  return document.head.querySelector('meta[name="robots"][data-noindex]');
}

describe('the not-found screen', () => {
  beforeEach(() => {
    robotsTag()?.remove();
  });

  it('says the address does not exist, rather than showing the front page', () => {
    renderNotFound();

    expect(
      screen.getByRole('heading', { level: 1, name: COPY.pt.notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(COPY.pt.notFound.message)).toBeInTheDocument();
  });

  it('speaks the language of the address it was reached at', () => {
    renderNotFound('en');

    expect(
      screen.getByRole('heading', { level: 1, name: COPY.en.notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(COPY.en.notFound.message)).toBeInTheDocument();
  });

  it('offers the archive as the way out, and the header as the way home', () => {
    renderNotFound();

    expect(
      screen.getByRole('link', { name: COPY.pt.notFound.watch }),
    ).toHaveAttribute('href', '/watch');
    // The logo, as on every other screen — and the only link home, so that the
    // two do not collide as identically named links.
    expect(
      screen.getByRole('link', { name: COPY.pt.layout.backHome }),
    ).toHaveAttribute('href', '/');
  });

  // The point of the screen: `vercel.json` rewrites every unmatched path to
  // `index.html` with a 200, so without this a mistyped URL is a page that
  // reports success and duplicates the front page.
  it('tells search engines not to list the address', () => {
    renderNotFound();

    expect(robotsTag()?.content).toBe('noindex, nofollow');
  });

  it('takes the tag away again, so it cannot follow the visitor onward', () => {
    const { unmount } = renderNotFound();
    expect(robotsTag()).not.toBeNull();

    unmount();
    expect(robotsTag()).toBeNull();
  });
});
