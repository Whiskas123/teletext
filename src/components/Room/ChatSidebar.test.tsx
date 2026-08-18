// Feature: collaborative-teletext-rooms — Task 13.7 unit/example tests
// Validates: Requirement 5.2 (empty-chat indication is shown instead of an
// empty area when the room has no messages).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatSidebar, EMPTY_CHAT_LABEL } from './ChatSidebar';
import type { ChatApi } from '../../collab/useChat';

// Mock the chat hook so the sidebar is driven entirely by the controlled value
// returned here, with no live playhtml provider.
const useChatMock = vi.fn<() => ChatApi>();
vi.mock('../../collab/useChat', () => ({
  useChat: () => useChatMock(),
}));

// The console now carries the presence roster in its head, and presence is
// room-scoped — without this the component asks for a Room_ID that a bare render
// has no way to provide.
vi.mock('../../collab/usePresence', () => ({
  usePresence: () => ({
    members: [],
    me: { memberId: 'me-1', name: 'Guest-0001', color: '#ffffff' },
    count: 0,
    setDisplayName: vi.fn(() => 'ok' as const),
  }),
}));

describe('ChatSidebar', () => {
  it('shows the empty-chat indication when there are no messages (Req 5.2)', () => {
    useChatMock.mockReturnValue({
      messages: [],
      send: vi.fn<ChatApi['send']>(() => 'ok'),
    });

    render(<ChatSidebar />);

    expect(screen.getByText(EMPTY_CHAT_LABEL)).toBeInTheDocument();
    // The message log is not rendered while empty.
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });
});
