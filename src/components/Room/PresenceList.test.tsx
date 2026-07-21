// Feature: collaborative-teletext-rooms — Task 12.4 unit/example tests
// Validates: Requirements 2.3, 2.8 (presence list renders member names + count;
// shows the "No members online" indication when empty).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PresenceList, NO_MEMBERS_LABEL } from './PresenceList';
import type { PresenceApi, MemberIdentity } from '../../collab/usePresence';

// Mock the awareness-backed usePresence hook so no live playhtml is needed; the
// component is driven entirely by the controlled value returned here.
const usePresenceMock = vi.fn<() => PresenceApi>();
vi.mock('../../collab/usePresence', () => ({
  usePresence: () => usePresenceMock(),
}));

const me: MemberIdentity = {
  memberId: 'me-1',
  name: 'Guest-0001',
  color: '#ffffff',
};

function setPresence(members: MemberIdentity[]) {
  usePresenceMock.mockReturnValue({
    members,
    me,
    count: members.length,
    setDisplayName: vi.fn<PresenceApi['setDisplayName']>(() => 'ok'),
  });
}

describe('PresenceList', () => {
  it('renders each member name and the live count (Req 2.3, 2.7)', () => {
    const members: MemberIdentity[] = [
      me,
      { memberId: 'm-2', name: 'Alice', color: '#ff0000' },
      { memberId: 'm-3', name: 'Bob', color: '#00ff00' },
    ];
    setPresence(members);

    render(<PresenceList allowRename={false} />);

    // The local member is tagged "(you)".
    expect(screen.getByText(/Guest-0001/)).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Count is rendered.
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.queryByText(NO_MEMBERS_LABEL)).not.toBeInTheDocument();
  });

  it('shows the "No members online" indication when empty (Req 2.8)', () => {
    setPresence([]);

    render(<PresenceList allowRename={false} />);

    expect(screen.getByText(NO_MEMBERS_LABEL)).toBeInTheDocument();
    expect(screen.getByText('(0)')).toBeInTheDocument();
  });
});
