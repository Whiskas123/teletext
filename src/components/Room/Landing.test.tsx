// Feature: the front page — a coloured teletext index.
// Verifies: the wordmark, the PT/EN switch and what it changes, the four
// coloured ways in, that "ver" is where the rooms live now and holds two
// distinct kinds of watching, and that an entry with nowhere to go says so
// instead of pretending.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { Landing } from './Landing';
import { LanguageProvider } from './LanguageProvider';
import { ROOMS } from './rooms';
import type { Language } from '../../domain/landing';

/**
 * A storage the test controls.
 *
 * Only `sessionStorage` needs one now — it holds the session member id. The
 * language used to be kept in `localStorage` and is the address instead, so
 * there is no longer a preference for a test to seed or to read back.
 *
 * Node 24 defines its own storage globals and leaves them *undefined* unless
 * started with `--localstorage-file`, shadowing the ones jsdom would provide.
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

function renderLanding(language: Language = 'pt') {
  return render(
    <MemoryRouter initialEntries={[language === 'en' ? '/en' : '/']}>
      <LanguageProvider language={language}>
        <Landing />
      </LanguageProvider>
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

    for (const word of ['ver', 'criar', 'guestbook', 'sobre']) {
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

  // The switch is navigation now, not a stored preference. That is what gives
  // each language its own address — which is the only way a link card or a
  // search result can be written in one of them.
  it('PT/EN goes to the same page at the other language’s address', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /language|idioma/i }));
    expect(navigateMock).toHaveBeenCalledWith('/en');
  });

  it('is written in the language of the address it was reached at', () => {
    renderLanding('en');

    expect(screen.getByText('watch')).toBeInTheDocument();
    expect(screen.queryByText('ver')).not.toBeInTheDocument();
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

  it('sets the two kinds of watching apart, and puts the rooms under theirs', async () => {
    const user = userEvent.setup();
    renderLanding();

    await openWatch(user);

    // Flat, the choices were seven identical chips and "sozinho" read as a
    // seventh room. Each kind is named, and the note under the name is what
    // says which kind it is — six house names do not mention other people.
    expect(screen.getByText('só tu')).toBeInTheDocument();
    expect(screen.getByText('com outras pessoas')).toBeInTheDocument();

    // The rooms belong to their name rather than sitting loose beside it, and
    // are grouped so that is heard as well as seen.
    const rooms = screen.getByRole('group', { name: 'numa sala com outras pessoas' });
    for (const room of ROOMS) {
      expect(rooms).toContainElement(
        screen.getByRole('button', { name: `numa sala: ${room.label}` }),
      );
    }
    // Watching alone is the other kind, not one of them.
    expect(rooms).not.toContainElement(screen.getByRole('button', { name: 'sozinho' }));
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

  it('sobre opens the about page', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /sobre o projeto/i }));
    expect(navigateMock).toHaveBeenCalledWith('/about');
  });

  it('guestbook opens the book of signatures', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /assinar o guestbook/i }));
    expect(navigateMock).toHaveBeenCalledWith('/guestbook');
  });

  it('leads somewhere from every word in the index', async () => {
    const user = userEvent.setup();
    renderLanding();

    // Every entry has somewhere to go now. The mechanism for one that does not
    // is kept (`MenuAction.pending`) because the menu is a list that grows —
    // this asserts that nothing is currently using it and quietly doing
    // nothing, which is the failure it exists to prevent.
    for (const word of ['ver', 'criar', 'guestbook', 'sobre']) {
      expect(screen.getByText(word).closest('button')).not.toHaveAttribute(
        'aria-disabled',
      );
    }

    await user.click(screen.getByRole('button', { name: /sobre o projeto/i }));
    expect(navigateMock).toHaveBeenCalled();
  });
});
