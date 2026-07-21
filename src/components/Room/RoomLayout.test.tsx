// Feature: collaborative-teletext-rooms — RoomLayout shell.
// Verifies the room name (Room_ID) is displayed in the room chrome.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { RoomLayout } from './RoomLayout';

// RoomLayout composes ConnectionStatus (useConnection) and PresenceList
// (usePresence). Mock both collab hooks so the shell renders without a live
// playhtml provider.
vi.mock('../../collab/useConnection', () => ({
  useConnection: () => ({ status: 'connected' }),
}));

vi.mock('../../collab/usePresence', () => ({
  usePresence: () => ({
    members: [],
    me: { memberId: 'me-1', name: 'Guest-0001', color: '#ffffff' },
    count: 0,
    setDisplayName: vi.fn(() => 'ok' as const),
  }),
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
});
