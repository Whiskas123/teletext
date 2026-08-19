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
import { COPY } from '../../domain/copy';
import { DEFAULT_LANGUAGE } from '../../domain/landing';

/*
 * The controls are named through the copy table, not spelled out.
 *
 * Every label on this screen is translated, so a test that asked for the button
 * called "Next page" would be testing which language the app happens to open in
 * rather than what the button does — and would break the day the default
 * changed, which is the change least worth failing over.
 */
const copy = COPY[DEFAULT_LANGUAGE];

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

/*
 * The phone layout is a media query, and jsdom has no `matchMedia` — the hook
 * degrades to `false`, which is the desktop layout. Driven directly here so the
 * two arrangements can both be asserted.
 */
const isPhone = vi.fn(() => false);
vi.mock('../../utils/useMediaQuery', () => ({
  useMediaQuery: () => isPhone(),
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
    isPhone.mockReturnValue(false);
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

    await user.click(screen.getByRole('button', { name: copy.tv.dial('2') }));
    await user.click(screen.getByRole('button', { name: copy.tv.dial('4') }));
    // Nothing may have happened yet: two digits is a half-dialled number.
    expect(submitMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.tv.dial('3') }));

    expect(submitMock).toHaveBeenCalledWith(243);
    expectNoDirectNavigation();
  });

  it('proposes the page a step key would have moved to', async () => {
    const user = userEvent.setup();
    setRoomSync(100);
    renderViewer();

    await user.click(screen.getByRole('button', { name: copy.tv.nextPage }));
    expect(submitMock).toHaveBeenCalledWith(220);

    await user.click(screen.getByRole('button', { name: copy.tv.prevPage }));
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

    await user.click(
      screen.getByRole('button', { name: copy.tv.nextSubpage(1, 3) }),
    );

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
    const knob = screen.getByRole('button', { name: copy.directory.open });
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

    expect(
      screen.getByRole('region', { name: copy.vote.region }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chat-sidebar')).toBeInTheDocument();
  });

  describe('on a phone', () => {
    /*
     * The rail does not survive the width, so the consoles take turns in the
     * dock under the picture. What matters is that both are still *reachable* —
     * stacking them below a handset pinned to the foot of the window is what
     * this replaced, and it put them a full screen away.
     */
    it('shows one panel at a time, chosen from the dock tabs', async () => {
      const user = userEvent.setup();
      isPhone.mockReturnValue(true);
      setRoomSync(100);
      renderViewer();

      // The remote is what the dock opens on: dialling is the common errand.
      expect(screen.getByRole('tab', { name: copy.tv.remote })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.queryByRole('region', { name: copy.vote.region }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-sidebar')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: copy.vote.name }));
      expect(
        screen.getByRole('region', { name: copy.vote.region }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: copy.chat.name }));
      expect(screen.getByTestId('chat-sidebar')).toBeInTheDocument();
      // One at a time: the vote gave up the dock when the chat took it.
      expect(
        screen.queryByRole('region', { name: copy.vote.region }),
      ).not.toBeInTheDocument();
    });

    it('takes the handset out of the dock with the rest', async () => {
      const user = userEvent.setup();
      isPhone.mockReturnValue(true);
      setRoomSync(100);
      renderViewer();

      // The remote is a panel like the other two, not a floor the others stand
      // on: choosing another tab puts its keys away rather than pushing them
      // down the screen, which is the whole point of the dock.
      expect(
        screen.getByRole('button', { name: copy.tv.dial('5') }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: copy.chat.name }));
      expect(
        screen.queryByRole('button', { name: copy.tv.dial('5') }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: copy.tv.remote }));
      expect(
        screen.getByRole('button', { name: copy.tv.dial('5') }),
      ).toBeInTheDocument();
    });
  });
});
