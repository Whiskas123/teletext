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
