// Feature: the guestbook — the page where a signature is left and read.
// Verifies: the page opens on the book rather than on a form, the empty book
// says so, signatures are listed with the reader's own marked, typing on the
// grid reaches the snippet that gets signed, the pixel tool offers no
// background, and a refusal is reported rather than swallowed.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { GuestbookPage } from './GuestbookPage';
import type { GuestbookApi } from '../../collab/useGuestbook';
import { createEmptySnippet, type GuestbookEntry } from '../../domain/guestbook';
import type { TeletextPage } from '../../types/teletext';

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

const signMock = vi.fn<GuestbookApi['sign']>();
let entries: GuestbookEntry[] = [];
const MEMBER_ID = 'member-me';

vi.mock('../../collab/useGuestbook', () => ({
  useGuestbook: (): GuestbookApi => ({
    entries,
    memberId: MEMBER_ID,
    sign: signMock,
  }),
}));

/** A snippet with one character on it, so it is not blank. */
function signedSnippet(char = 'A'): TeletextPage {
  const cells = createEmptySnippet();
  cells[0] = { char, fg: 'white', bg: 'black', graphics: null };
  return cells;
}

function entry(over: Partial<GuestbookEntry> = {}): GuestbookEntry {
  return {
    id: 'sig-1',
    name: 'Ana',
    authorId: 'member-other',
    cells: signedSnippet(),
    ts: Date.parse('2026-01-02T00:00:00Z'),
    ...over,
  };
}

function renderGuestbook() {
  return render(
    <MemoryRouter>
      <GuestbookPage />
    </MemoryRouter>,
  );
}

/** The form is not on the page until it is asked for. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Assinar' }));
}

/** Type on the grid, which takes typing as a whole with the caret as the point. */
async function typeOnGrid(user: ReturnType<typeof userEvent.setup>, text: string) {
  screen.getByRole('group', { name: /a tua página/i }).focus();
  await user.keyboard(text);
}

describe('the guestbook', () => {
  beforeEach(() => {
    signMock.mockReset();
    signMock.mockReturnValue({ ok: true, name: 'Ana' });
    entries = [];
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('says the book is empty rather than showing an empty area', () => {
    renderGuestbook();
    expect(screen.getByText(/ainda ninguém assinou/i)).toBeInTheDocument();
  });

  it('opens on the book, not on a form', async () => {
    const user = userEvent.setup();
    renderGuestbook();

    // The signatures are the work. A screen that opens on an empty form beside
    // an empty grid says "fill this in" when it should say "look at these".
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: /a tua página/i }),
    ).not.toBeInTheDocument();

    const opener = screen.getByRole('button', { name: 'Assinar' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');

    await user.click(opener);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // The caret goes where a signer is already looking, since the form is below
    // the book in the document and opening it moves nothing.
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('closes again', async () => {
    const user = userEvent.setup();
    renderGuestbook();

    await openForm(user);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('offers no background while the pixel tool is selected', async () => {
    const user = userEvent.setup();
    renderGuestbook();
    await openForm(user);

    // Text has both: a character is drawn in one colour on another.
    expect(screen.getByRole('group', { name: 'Cor' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Fundo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pixel' }));

    // A pixel is one sixth of a cell in one colour; the other five are the
    // cell's own background, so a background picker here would repaint the
    // parts that were not clicked.
    expect(screen.getByRole('group', { name: 'Cor' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Fundo' })).not.toBeInTheDocument();
  });

  it('lists the signatures it is given, in the order it is given them', () => {
    // The hook hands them over already ordered — `sortEntries` is what decides
    // that, and it is tested where it lives.
    entries = [
      entry({ id: 'b', name: 'Beto' }),
      entry({ id: 'a', name: 'Ana' }),
    ];
    renderGuestbook();

    const listed = screen.getAllByRole('listitem');
    expect(listed).toHaveLength(2);
    expect(within(listed[0]).getByText('Beto')).toBeInTheDocument();
    expect(within(listed[1]).getByText('Ana')).toBeInTheDocument();
  });

  it('marks the reader’s own signature', () => {
    entries = [
      entry({ id: 'a', name: 'Ana', authorId: MEMBER_ID }),
      entry({ id: 'b', name: 'Beto', authorId: 'member-other' }),
    ];
    renderGuestbook();

    const listed = screen.getAllByRole('listitem');
    expect(within(listed[0]).getByText(/a tua/i)).toBeInTheDocument();
    expect(within(listed[1]).queryByText(/a tua/i)).not.toBeInTheDocument();
  });

  it('signs with the name given and what was typed on the grid', async () => {
    const user = userEvent.setup();
    renderGuestbook();
    await openForm(user);

    await user.type(screen.getByRole('textbox'), 'Ana');
    await typeOnGrid(user, 'OI');

    await user.click(screen.getByRole('button', { name: 'Assinar' }));

    expect(signMock).toHaveBeenCalledTimes(1);
    const [name, cells] = signMock.mock.calls[0];
    expect(name).toBe('Ana');
    expect(cells[0].char).toBe('O');
    expect(cells[1].char).toBe('I');
  });

  it('clears the page after signing, and keeps the name', async () => {
    const user = userEvent.setup();
    renderGuestbook();
    await openForm(user);

    await user.type(screen.getByRole('textbox'), 'Ana');
    await typeOnGrid(user, 'OI');
    await user.click(screen.getByRole('button', { name: 'Assinar' }));

    expect(screen.getByText(/assinado\. obrigado/i)).toBeInTheDocument();
    // Signing twice is allowed; retyping your own name to do it would not be.
    expect(screen.getByRole('textbox')).toHaveValue('Ana');

    await user.click(screen.getByRole('button', { name: 'Assinar' }));
    const [, cells] = signMock.mock.calls[1];
    expect(cells.every((cell) => cell.char === ' ')).toBe(true);
  });

  it('says why a signature was refused instead of swallowing it', async () => {
    const user = userEvent.setup();
    signMock.mockReturnValue({ ok: false, reason: 'blank' });
    renderGuestbook();
    await openForm(user);

    await user.type(screen.getByRole('textbox'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Assinar' }));

    expect(screen.getByRole('status')).toHaveTextContent(/está vazia/i);
  });

  it('reports a missing name against the field, not the page', async () => {
    const user = userEvent.setup();
    signMock.mockReturnValue({ ok: false, reason: 'no-name' });
    renderGuestbook();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(screen.getByRole('status')).toHaveTextContent(/escreve um nome/i);
  });

  it('clears the page on request', async () => {
    const user = userEvent.setup();
    renderGuestbook();
    await openForm(user);

    await typeOnGrid(user, 'OI');
    await user.click(screen.getByRole('button', { name: 'Limpar' }));

    await user.type(screen.getByRole('textbox'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Assinar' }));

    const [, cells] = signMock.mock.calls[0];
    expect(cells.every((cell) => cell.char === ' ')).toBe(true);
  });
});
