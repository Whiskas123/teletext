// Feature: collaborative-teletext-rooms — Landing page entry points.
// Verifies: project title/description, the three ways in (watch solo, watch
// together, create/edit), the six fixed rooms behind "Watch together", and that
// nothing asks for a name up front.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { Landing } from './Landing';
import { ROOMS } from './rooms';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

/** Open the "Watch together" option so the room grid is revealed. */
async function openRooms(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: /watch teletext together/i }),
  );
}

describe('Landing', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    try {
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('shows the project title and description', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { name: /teletext rooms/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/watch teletext on your own/i)).toBeInTheDocument();
  });

  it('offers the three entry points without asking for a name', () => {
    renderLanding();

    expect(
      screen.getByRole('button', { name: /watch teletext solo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /watch teletext together/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create or edit teletext pages/i }),
    ).toBeInTheDocument();

    // Names are optional everywhere: no name prompt gates the entry screen.
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it('watch solo opens the solo viewer', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /watch teletext solo/i }));
    expect(navigateMock).toHaveBeenCalledWith('/watch');
  });

  it('create / edit opens the solo editor', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(
      screen.getByRole('button', { name: /create or edit teletext pages/i }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/edit');
  });

  it('watch together reveals the six fixed rooms, each with a single Watch action', async () => {
    const user = userEvent.setup();
    renderLanding();

    // The rooms stay out of the way until "Watch together" is chosen.
    expect(screen.queryByText('Living Room')).not.toBeInTheDocument();

    await openRooms(user);

    for (const room of ROOMS) {
      expect(screen.getByText(room.label)).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: new RegExp(`watch teletext in ${room.label}`, 'i'),
        }),
      ).toBeInTheDocument();
    }
    // Six rooms × one Watch action = six watch buttons; no per-room edit or
    // create-room control.
    expect(
      screen.getAllByRole('button', { name: /watch teletext in/i }),
    ).toHaveLength(6);
    expect(
      screen.queryByRole('button', { name: /edit teletext in/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create room/i }),
    ).not.toBeInTheDocument();
  });

  it('Watch navigates into the room viewer', async () => {
    const user = userEvent.setup();
    renderLanding();

    await openRooms(user);
    await user.click(
      screen.getByRole('button', { name: /watch teletext in kitchen/i }),
    );

    expect(navigateMock).toHaveBeenCalledWith('/room/kitchen');
  });
});
