// Feature: collaborative-teletext-rooms — Task 12.4 unit/example tests
// Validates: Requirements 8.1, 8.2 (disconnected indicator shown while
// disconnected; nothing rendered when connected).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ConnectionStatus, DISCONNECTED_LABEL } from './ConnectionStatus';
import type { ConnectionApi } from '../../collab/useConnection';

// Mock the connection hook so we can drive the derived status directly without
// a live playhtml provider.
const useConnectionMock = vi.fn<() => ConnectionApi>();
vi.mock('../../collab/useConnection', () => ({
  useConnection: () => useConnectionMock(),
}));

describe('ConnectionStatus', () => {
  it('shows the disconnected indicator when status is disconnected (Req 8.1)', () => {
    useConnectionMock.mockReturnValue({ status: 'disconnected' });

    render(<ConnectionStatus />);

    expect(screen.getByText(DISCONNECTED_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders nothing when status is connected (Req 8.2)', () => {
    useConnectionMock.mockReturnValue({ status: 'connected' });

    const { container } = render(<ConnectionStatus />);

    expect(screen.queryByText(DISCONNECTED_LABEL)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
