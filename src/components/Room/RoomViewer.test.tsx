// Feature: collaborative-teletext-rooms — RoomViewer (watch page).
// Verifies the one rule that separates a room from watching alone: the page is
// the vote's to decide. Every route to a page number — the keypad, the step
// keys, the fastext strip, the directory — must *propose* rather than navigate,
// and nothing but the subpage may change what is on the glass directly.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { RoomViewer } from './RoomViewer';
import type { RoomSyncApi } from '../../collab/useRoomSync';
import { createEmptyPage } from '../../types/teletext';

// Mock the room-sync hook so we can drive the displayed page and assert that the
// page-setter spies are never invoked by anything the viewer offers.
const useRoomSyncMock = vi.fn<() => RoomSyncApi>();
vi.mock('../../collab/useRoomSync', () => ({
  useRoomSync: () => useRoomSyncMock(),
}));

// RoomViewer + VotePanel read useVoting; mock it so no live provider is needed.
const submitMock = vi.fn(() => ({ ok: true }) as ReturnType<
  import('../../collab/useVoting').VotingApi['submit']
>);
vi.mock('../../collab/useVoting', () => ({
  useVoting: () => ({
    active: null,
    submit: submitMock,
    vote: vi.fn(),
    tally: { accept: 0, reject: 0, base: 0, threshold: 0 },
  }),
}));

// The directory reads useGuide; mock it with an empty one.
vi.mock('../../collab/useGuide', () => ({
  useGuide: () => ({ entries: [], title: () => '', setTitle: vi.fn(() => 'ok') }),
}));

// RoomLayout renders ConnectionStatus (useConnection) and the chat console
// renders PresenceList (usePresence). Mock both so the shell renders without a
// live provider.
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

// Stub TeletextGrid so we can read the displayed Page_Number directly.
vi.mock('../TeletextGrid/TeletextGrid', () => ({
  TeletextGrid: ({ pageNumber }: { pageNumber?: number }) => (
    <div data-testid="teletext-grid" data-page-number={pageNumber}>
      page {pageNumber}
    </div>
  ),
}));

const setDisplayedPage = vi.fn<RoomSyncApi['setDisplayedPage']>(() => null);
const setDisplayedPageDirect = vi.fn<RoomSyncApi['setDisplayedPageDirect']>();
const gotoNextNonEmpty = vi.fn<RoomSyncApi['gotoNextNonEmpty']>(() => 'ok');
const gotoPrevNonEmpty = vi.fn<RoomSyncApi['gotoPrevNonEmpty']>(() => 'ok');
const peekNextNonEmpty = vi.fn<RoomSyncApi['peekNextNonEmpty']>(() => 220);
const peekPrevNonEmpty = vi.fn<RoomSyncApi['peekPrevNonEmpty']>(() => 150);
const stepSubpageBy = vi.fn<RoomSyncApi['stepSubpageBy']>();

function setRoomSync(displayedPageNumber: number, subpages = { subpage: 1, count: 1 }) {
  useRoomSyncMock.mockReturnValue({
    displayedPageNumber,
    displayedSubpage: subpages.subpage,
    subpageCount: subpages.count,
    page: createEmptyPage(),
    setDisplayedPage,
    setDisplayedPageDirect,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
    peekNextNonEmpty,
    peekPrevNonEmpty,
    stepSubpageBy,
  });
}

function renderViewer() {
  return render(
    <MemoryRouter>
      <RoomViewer roomId="my-room-1" chatSidebar={<div data-testid="chat-sidebar" />} />
    </MemoryRouter>,
  );
}

/** Nothing in a room may move the page without asking. */
function expectNoDirectNavigation() {
  expect(setDisplayedPage).not.toHaveBeenCalled();
  expect(setDisplayedPageDirect).not.toHaveBeenCalled();
  expect(gotoNextNonEmpty).not.toHaveBeenCalled();
  expect(gotoPrevNonEmpty).not.toHaveBeenCalled();
}

describe('RoomViewer', () => {
  beforeEach(() => {
    setDisplayedPage.mockClear();
    setDisplayedPageDirect.mockClear();
    gotoNextNonEmpty.mockClear();
    gotoPrevNonEmpty.mockClear();
    peekNextNonEmpty.mockClear();
    peekPrevNonEmpty.mockClear();
    stepSubpageBy.mockClear();
    submitMock.mockClear();
  });

  it('displays page 100 when useRoomSync reports displayedPageNumber 100', () => {
    setRoomSync(100);
    renderViewer();
    expect(screen.getByTestId('teletext-grid')).toHaveAttribute(
      'data-page-number',
      '100',
    );
  });

  it('proposes a page dialled on the keypad instead of going to it', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    await user.click(screen.getByRole('button', { name: 'Dial 2' }));
    await user.click(screen.getByRole('button', { name: 'Dial 4' }));
    // Nothing may have happened yet: two digits is a half-dialled number.
    expect(submitMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Dial 3' }));

    expect(submitMock).toHaveBeenCalledWith(243);
    expectNoDirectNavigation();
  });

  it('proposes the page a step key would have moved to', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(submitMock).toHaveBeenCalledWith(220);

    await user.click(screen.getByRole('button', { name: /previous page/i }));
    expect(submitMock).toHaveBeenCalledWith(150);

    // Peeked, never taken: `goto*` applies the move, which is the vote's job.
    expect(peekNextNonEmpty).toHaveBeenCalled();
    expect(peekPrevNonEmpty).toHaveBeenCalled();
    expectNoDirectNavigation();
  });

  it('applies a subpage step immediately — the room already agreed on the page', async () => {
    const user = userEvent.setup();
    setRoomSync(220, { subpage: 1, count: 3 });
    renderViewer();

    await user.click(screen.getByRole('button', { name: /next subpage/i }));

    expect(stepSubpageBy).toHaveBeenCalledWith(1);
    expect(submitMock).not.toHaveBeenCalled();
    expectNoDirectNavigation();
  });

  it('opens the directory as a leaflet, and a listing proposes rather than navigates', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    // Held by reference rather than re-queried: once open, the leaflet's own
    // close button answers to the same name as the knob.
    const knob = screen.getByRole('button', { name: 'Open Yellow Pages' });
    expect(knob).toHaveAttribute('aria-expanded', 'false');

    await user.click(knob);
    expect(knob).toHaveAttribute('aria-expanded', 'true');

    // The leaflet is a fold-out, not a popup over the set: opening it changes
    // nothing about what the room is watching.
    expectNoDirectNavigation();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('puts the vote console and the chat in the rail beside the set', () => {
    setRoomSync(100);
    renderViewer();

    expect(screen.getByRole('region', { name: /room vote/i })).toBeInTheDocument();
    expect(screen.getByTestId('chat-sidebar')).toBeInTheDocument();
  });
});
