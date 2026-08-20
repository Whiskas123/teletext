// Feature: the about page — the one screen on the site that is prose.
// Verifies: that it opens in Portuguese as the rest of the site does, that the
// PT/EN switch changes the whole document and is remembered, that the sections
// arrive in both languages, and that the two outbound links are real links
// which do not take a reader out of the room they were watching in.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { AboutPage } from './AboutPage';
import { ABOUT, ABOUT_SECTIONS } from '../../domain/about';
import { LANGUAGE_STORAGE_KEY } from '../../domain/landing';

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

function renderAbout() {
  return render(
    <MemoryRouter>
      <AboutPage />
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

  it('carries every section in both languages', async () => {
    const user = userEvent.setup();
    renderAbout();

    for (const { id } of ABOUT_SECTIONS) {
      expect(
        screen.getByRole('heading', { level: 2, name: ABOUT.pt.sections[id].heading }),
      ).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: /idioma|language/i }));

    for (const { id } of ABOUT_SECTIONS) {
      expect(
        screen.getByRole('heading', { level: 2, name: ABOUT.en.sections[id].heading }),
      ).toBeInTheDocument();
    }
  });

  it('remembers the language, which is a fact about the reader', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAbout();

    await user.click(screen.getByRole('button', { name: /idioma|language/i }));
    expect(screen.getByRole('heading', { level: 1, name: 'about' })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    // The switch is on this screen precisely because a reader can arrive here
    // from a link without ever having seen the front page — so the choice they
    // make here has to be the same choice the front page would have stored.
    unmount();
    renderAbout();
    expect(screen.getByRole('heading', { level: 1, name: 'about' })).toBeInTheDocument();
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

  it('sends the reader to the author’s site in the language they are reading', async () => {
    const user = userEvent.setup();
    renderAbout();

    // Following a name mid-sentence should not switch language on someone.
    expect(screen.getByRole('link', { name: /joão bernardo narciso/i })).toHaveAttribute(
      'href',
      'https://joaobernardo.me',
    );

    await user.click(screen.getByRole('button', { name: /idioma|language/i }));

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
