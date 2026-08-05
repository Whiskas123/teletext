// Feature: collaborative-teletext-rooms — RoomViewer (watch page).
// Verifies: the default page is displayed; the object bar exposes the remote
// control and yellow pages; opening the yellow pages directory never changes the
// displayed page (page changes go through the vote).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { RoomViewer } from './RoomViewer';
import type { RoomSyncApi } from '../../collab/useRoomSync';
import { createEmptyPage } from '../../types/teletext';

// Mock the room-sync hook so we can drive the displayed page and assert that the
// page-setter spies are never invoked when opening the yellow pages.
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

// YellowPages reads useGuide; mock it with an empty directory.
vi.mock('../../collab/useGuide', () => ({
  useGuide: () => ({ entries: [], title: () => '', setTitle: vi.fn(() => 'ok') }),
}));

// RoomLayout renders ConnectionStatus (useConnection) and PresenceList
// (usePresence). Mock both so the shell renders without a live provider.
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

describe('RoomViewer', () => {
  beforeEach(() => {
    setDisplayedPage.mockClear();
    setDisplayedPageDirect.mockClear();
    gotoNextNonEmpty.mockClear();
    gotoPrevNonEmpty.mockClear();
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

  it('shows the remote control and yellow pages objects, and no page stepping', () => {
    setRoomSync(100);
    renderViewer();
    expect(
      screen.getByRole('button', { name: 'Remote control' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yellow pages' }),
    ).toBeInTheDocument();
    // Which page a room watches is the vote's to decide, so the solo set's
    // page knobs are decoration here. The *subpage* knobs are not stepping
    // between pages and are asserted separately below.
    expect(
      screen.queryByRole('button', { name: /previous page/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /next page/i }),
    ).not.toBeInTheDocument();
  });

  it('steps the whole room through a page carousel without a vote', async () => {
    const user = userEvent.setup();
    setRoomSync(220, { subpage: 1, count: 3 });
    renderViewer();

    await user.click(screen.getByRole('button', { name: /next subpage/i }));

    // Straight to the shared state: a subpage is part of the page the room
    // already agreed on, so turning to it is reading rather than changing.
    expect(stepSubpageBy).toHaveBeenCalledWith(1);
    expect(setDisplayedPage).not.toHaveBeenCalled();
  });

  it('opens the yellow pages directory without changing the displayed page', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    // The directory dialog is not mounted until the object is clicked.
    expect(screen.queryByRole('dialog', { name: /yellow pages/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yellow pages' }));

    expect(screen.getByRole('dialog', { name: /yellow pages/i })).toBeInTheDocument();
    // Opening the directory never changes the displayed page.
    expect(setDisplayedPage).not.toHaveBeenCalled();
    expect(setDisplayedPageDirect).not.toHaveBeenCalled();
    expect(gotoNextNonEmpty).not.toHaveBeenCalled();
    expect(gotoPrevNonEmpty).not.toHaveBeenCalled();
  });

  it('opens the remote control popover with the request controls', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    await user.click(screen.getByRole('button', { name: 'Remote control' }));

    // The popover dialog contains the "Request a page" control from VotePanel.
    const dialog = screen.getByRole('dialog', { name: 'Remote control' });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: /request a page/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /request/i }),
    ).toBeInTheDocument();
  });

  it('closes the yellow pages directory when its own icon is clicked again', async () => {
    // The icon used to only ever open. Because the directory's backdrop covers
    // the whole screen, the icon was underneath it, so a second click landed on
    // the backdrop instead — a double-click opened and closed the directory
    // (looking like nothing happened), and two deliberate clicks made it flash.
    // It is now a toggle, and the object bar sits above the backdrop so the
    // click reaches it.
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    const icon = screen.getByRole('button', { name: 'Yellow pages' });
    expect(icon).toHaveAttribute('aria-expanded', 'false');

    await user.click(icon);
    expect(screen.getByRole('dialog', { name: 'Yellow Pages' })).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-expanded', 'true');

    await user.click(icon);
    expect(screen.queryByRole('dialog', { name: 'Yellow Pages' })).not.toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-expanded', 'false');

    // And it still opens again afterwards.
    await user.click(icon);
    expect(screen.getByRole('dialog', { name: 'Yellow Pages' })).toBeInTheDocument();
  });
});
