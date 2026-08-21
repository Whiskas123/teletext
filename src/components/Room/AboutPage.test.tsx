// Feature: the about page — the one screen on the site that is prose.
// Verifies: that it opens in Portuguese as the rest of the site does, that the
// PT/EN switch changes the whole document and is remembered, that the sections
// arrive in both languages, and that the two outbound links are real links
// which do not take a reader out of the room they were watching in.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { AboutPage } from './AboutPage';
import { LanguageProvider } from './LanguageProvider';
import { ABOUT, ABOUT_SECTIONS } from '../../domain/about';
import type { Language } from '../../domain/landing';

/** A storage the test controls — see the note in `Landing.test.tsx`. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage;
}

function renderAbout(language: Language = 'pt') {
  return render(
    <MemoryRouter initialEntries={[language === 'en' ? '/en/about' : '/about']}>
      <LanguageProvider language={language}>
        <AboutPage />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('the about page', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('opens in Portuguese, as the rest of the site does', () => {
    renderAbout();

    expect(screen.getByRole('heading', { level: 1, name: 'sobre' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'about' })).not.toBeInTheDocument();
  });

  // Each language is its own address, so this reads them as a reader would
  // arrive at them rather than by clicking the switch: the switch navigates
  // now, and navigation is what the other test is about.
  it('carries every section in both languages', () => {
    for (const { id } of ABOUT_SECTIONS) {
      const { unmount } = renderAbout();
      expect(
        screen.getByRole('heading', { level: 2, name: ABOUT.pt.sections[id].heading }),
      ).toBeInTheDocument();
      unmount();

      renderAbout('en');
      expect(
        screen.getByRole('heading', { level: 2, name: ABOUT.en.sections[id].heading }),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  // The switch is on this screen precisely because a reader can arrive here
  // from a link without ever having seen the front page. It now takes them to
  // this same screen at the other language's address, which is a place they can
  // link to in turn — where a stored preference was private to their browser.
  it('switches to the same page at the other language’s address', async () => {
    const user = userEvent.setup();
    renderAbout();

    await user.click(screen.getByRole('button', { name: /idioma|language/i }));
    expect(navigateMock).toHaveBeenCalledWith('/en/about');
  });

  it('is written in the language of the address it was reached at', () => {
    renderAbout('en');
    expect(
      screen.getByRole('heading', { level: 1, name: 'about' }),
    ).toBeInTheDocument();
  });

  it('links out to the author and the archive, without stealing the tab', () => {
    renderAbout();

    const author = screen.getByRole('link', { name: /joão bernardo narciso/i });
    const arquivo = screen.getByRole('link', { name: /arquivo\.pt/i });
    expect(arquivo).toHaveAttribute('href', 'https://arquivo.pt');

    // A reader glancing at a link mid-sentence should not lose a room they were
    // watching in to do it.
    for (const link of [author, arquivo]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('sends the reader to the author’s site in the language they are reading', () => {
    // Following a name mid-sentence should not switch language on someone.
    const { unmount } = renderAbout();
    expect(screen.getByRole('link', { name: /joão bernardo narciso/i })).toHaveAttribute(
      'href',
      'https://joaobernardo.me',
    );
    unmount();

    renderAbout('en');
    expect(screen.getByRole('link', { name: /joão bernardo narciso/i })).toHaveAttribute(
      'href',
      'https://joaobernardo.me/en',
    );
  });

  it('offers the way back to the front page', () => {
    renderAbout();
    expect(screen.getByRole('link', { name: /início|home/i })).toHaveAttribute('href', '/');
  });
});
