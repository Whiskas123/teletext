// Feature: collaborative-teletext-rooms — Landing page + fixed room picker.
// Verifies: project title/description, required name capture, the six fixed
// rooms, and navigation into a selected room (no create-room control).

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

describe('Landing', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    // Clear any persisted display name so each test starts at the name stage.
    try {
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('shows the project title, description, and a name prompt', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: /teletext rooms/i })).toBeInTheDocument();
    expect(screen.getByText(/watch teletext together/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
  });

  it('requires a name before showing the rooms', async () => {
    const user = userEvent.setup();
    renderLanding();

    // Rooms are not shown until a name is provided.
    expect(screen.queryByText('Living Room')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Living Room')).not.toBeInTheDocument();
  });

  it('shows the six fixed rooms each with a single Watch action, and no per-room edit or create control', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    for (const room of ROOMS) {
      // Each room label is shown, with a single Watch action.
      expect(screen.getByText(room.label)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: new RegExp(`watch teletext in ${room.label}`, 'i') }),
      ).toBeInTheDocument();
    }
    // Six rooms × one Watch action = six watch buttons; no per-room edit button.
    expect(screen.getAllByRole('button', { name: /watch teletext in/i })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /edit teletext in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create room/i })).not.toBeInTheDocument();
  });

  it('has a single, separate edit-teletext action that opens the solo editor', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const editButton = screen.getByRole('button', { name: /open the teletext editor/i });
    expect(editButton).toBeInTheDocument();

    await user.click(editButton);
    expect(navigateMock).toHaveBeenCalledWith('/edit');
  });

  it('Watch navigates into the room viewer', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /watch teletext in kitchen/i }));

    expect(navigateMock).toHaveBeenCalledWith('/room/kitchen');
  });
});
