// Feature: the front page — a coloured teletext index.
// Verifies: the wordmark, the PT/EN switch and what it changes, the four
// coloured ways in, that "ver" is where the rooms live now, and that an entry
// with nowhere to go says so instead of pretending.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { Landing } from './Landing';
import { ROOMS } from './rooms';
import { LANGUAGE_STORAGE_KEY } from '../../domain/landing';

/**
 * A storage the test controls.
 *
 * Node 24 defines its own `localStorage` global and leaves it *undefined*
 * unless started with `--localstorage-file`, which shadows the one jsdom would
 * otherwise provide. `useLanguage` copes — it wraps every access and falls back
 * to remembering the choice for this tab only — but a test that wants to prove
 * the choice is *persisted* has to supply somewhere to persist it.
 */
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

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

/**
 * Which pages are already claimed, as the live document would report them.
 * The front page uses this to open the editor on a blank page rather than
 * dropping everyone on the same one.
 */
let occupiedPages: number[] = [];
vi.mock('../../collab/useOccupiedPages', () => ({
  useOccupiedPages: () => occupiedPages,
}));

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

/** Open "ver", which is where watching alone and the rooms both live. */
async function openWatch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /ver teletexto/i }));
}

describe('the front page', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    occupiedPages = [];
    // A fresh one per test, so a language chosen in one does not leak.
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  it('shows the wordmark', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { name: /tele-textual/i }),
    ).toBeInTheDocument();
  });

  it('offers the four ways in, in the palette, without asking for a name', () => {
    renderLanding();

    for (const word of ['ver', 'criar', 'sugerir', 'sobre']) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    // Names are optional everywhere: no name prompt gates the entry screen.
    expect(screen.queryByLabelText(/your name|o seu nome/i)).not.toBeInTheDocument();
  });

  it('opens in Portuguese, because the archive is', () => {
    renderLanding();
    expect(screen.getByText('ver')).toBeInTheDocument();
    expect(screen.queryByText('watch')).not.toBeInTheDocument();
  });

  it('PT/EN switches the menu and remembers the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLanding();

    await user.click(screen.getByRole('button', { name: /language|idioma/i }));

    expect(screen.getByText('watch')).toBeInTheDocument();
    expect(screen.queryByText('ver')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    // A language is a fact about the reader, not about this visit: coming back
    // to Portuguese having chosen English is a small insult that reads as the
    // toggle being broken.
    unmount();
    renderLanding();
    expect(screen.getByText('watch')).toBeInTheDocument();
  });

  it('criar opens the first free playground page', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /criar e editar/i }));
    expect(navigateMock).toHaveBeenCalledWith('/edit/700');
  });

  it('skips playground pages that are already taken', async () => {
    // Landing everyone on the first playground number meant two people
    // creating a page at once overwrote each other.
    occupiedPages = [700, 701, 703];
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /criar e editar/i }));
    expect(navigateMock).toHaveBeenCalledWith('/edit/702');
  });

  it('falls back to the editor default when the playground is full', async () => {
    occupiedPages = Array.from({ length: 300 }, (_, i) => 700 + i);
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /criar e editar/i }));
    expect(navigateMock).toHaveBeenCalledWith('/edit');
  });

  it('ver reveals watching alone and the six rooms', async () => {
    const user = userEvent.setup();
    renderLanding();

    // The choices stay out of the way until "ver" is chosen — the front page is
    // four words, and a room list on it would not be.
    expect(screen.queryByText('Living Room')).not.toBeInTheDocument();

    await openWatch(user);

    // Matched exactly, not by substring: "ver"'s own hint reads "Ver
    // teletexto, sozinho ou numa sala", so a loose match finds the word that
    // opened the menu as well as the choices inside it.
    expect(screen.getByRole('button', { name: 'sozinho' })).toBeInTheDocument();
    for (const room of ROOMS) {
      expect(
        screen.getByRole('button', { name: `numa sala: ${room.label}` }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole('button', { name: /^numa sala: / }),
    ).toHaveLength(6);
  });

  it('ver leads to watching alone, and to a room', async () => {
    const user = userEvent.setup();
    renderLanding();

    await openWatch(user);
    await user.click(screen.getByRole('button', { name: 'sozinho' }));
    expect(navigateMock).toHaveBeenCalledWith('/watch');

    await user.click(screen.getByRole('button', { name: 'numa sala: Kitchen' }));
    expect(navigateMock).toHaveBeenCalledWith('/room/kitchen');
  });

  it('says so when an entry has nowhere to go yet, and goes nowhere', async () => {
    const user = userEvent.setup();
    renderLanding();

    for (const name of [/sugerir/i, /sobre/i]) {
      const entry = screen.getByRole('button', { name });
      // A word that takes a click and silently does nothing is worse than one
      // that is not there, so it is marked rather than left to be discovered.
      expect(entry).toHaveAttribute('aria-disabled', 'true');
      expect(entry).toHaveAccessibleName(/em breve/i);
      await user.click(entry);
    }

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
