// Feature: collaborative-teletext-rooms — RoomLayout shell.
// Verifies the room name (Room_ID) is displayed in the room chrome, and that
// the shell works outside a room (solo viewer): a plain title and no sidebar.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { RoomLayout } from './RoomLayout';

// RoomLayout composes ConnectionStatus (useConnection). Mock it so the shell
// renders without a live playhtml provider.
vi.mock('../../collab/useConnection', () => ({
  useConnection: () => ({ status: 'connected' }),
}));

describe('RoomLayout', () => {
  it('displays the Room_ID', () => {
    render(
      <MemoryRouter>
        <RoomLayout roomId="my-room-1">
          <div>content</div>
        </RoomLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('my-room-1')).toBeInTheDocument();
  });

  it('renders the sidebar only when one is supplied', () => {
    const { rerender } = render(
      <MemoryRouter>
        <RoomLayout roomId="my-room-1">
          <div>content</div>
        </RoomLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <RoomLayout roomId="my-room-1" sidebar={<div>panels</div>}>
          <div>content</div>
        </RoomLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('panels')).toBeInTheDocument();
  });

  it('shows a plain title outside a room', () => {
    render(
      <MemoryRouter>
        <RoomLayout title="Watch solo">
          <div>content</div>
        </RoomLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('Watch solo')).toBeInTheDocument();
    expect(screen.queryByText('Room')).not.toBeInTheDocument();
  });
});
