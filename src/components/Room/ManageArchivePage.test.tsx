// Feature: manage-page-tabs — the /manage shell.
// Verifies: which tab is selected and how that reaches the URL, keyboard
// traversal of the tab strip, that only the selected panel exists, that an action
// disables its own page and nothing else, and that destructive actions ask first.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ManageArchivePage } from './ManageArchivePage';
import type { ArchiveAdminApi, PublishedEntry } from '../../collab/useArchiveAdmin';

/* --- What the collab layer would say ------------------------------------- */

let admin = { admin: true, loading: false, configured: true };
vi.mock('../../collab/useIsModerator', () => ({
  useAdminStatus: () => admin,
}));

let connectionStatus: 'connected' | 'disconnected' = 'connected';
vi.mock('../../collab/useConnection', () => ({
  useConnection: () => ({ status: connectionStatus }),
}));

vi.mock('../../collab/useSnapshot', () => ({
  useSnapshot: () => ({
    snapshot: vi.fn(),
    saving: false,
    error: null,
    lastResult: null,
    pageCount: 3,
  }),
}));

let kinds: Record<number, 'category' | 'subcategory' | 'page'> = {};
const setKind = vi.fn();
vi.mock('../../collab/usePageKinds', () => ({
  usePageKinds: () => ({
    kinds,
    kindOf: (page: number) => kinds[page] ?? 'page',
    setKind,
  }),
}));

/** The hook's input, captured so the deferred-loading rules can be asserted. */
let lastInput: unknown = null;
let data: ArchiveAdminApi;
vi.mock('../../collab/useArchiveAdmin', () => ({
  useArchiveAdmin: (input: unknown) => {
    lastInput = input;
    return data;
  },
}));

function entry(pageNumber: number): PublishedEntry {
  return {
    page_number: pageNumber,
    capture_id: pageNumber,
    title: `Title ${pageNumber}`,
    description: '',
    published_at: '2001-06-11T00:00:00.000Z',
    source: 'rtp',
    original_page: 220,
    sub: '01',
    topic: 'desporto',
    scheme: '1998-2000',
    first_seen: '1998-06-15',
    manifest_title: null,
    shift_down: true,
    menu_id: null,
    menu_name: null,
  };
}

const titles: Record<number, string> = {
  204: 'Noticias',
  412: 'Desporto',
  712: 'My playground page',
};

/** A stand-in data layer whose actions can be resolved by the test. */
function makeData(overrides: Partial<ArchiveAdminApi> = {}): ArchiveAdminApi {
  const published = [entry(204)];
  return {
    captures: [],
    total: 0,
    published,
    publishedByPage: new Map(published.map((e) => [e.page_number, e])),
    menus: [],
    loading: false,
    error: null,
    publishedError: null,
    pageSize: 60,
    retryCaptures: vi.fn(),
    reloadPublished: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(null),
    livePage: vi.fn().mockReturnValue(null),
    transform: (page) => page,
    publish: vi.fn().mockResolvedValue({ ok: true }),
    unpublish: vi.fn().mockResolvedValue({ ok: true }),
    saveMenu: vi.fn().mockResolvedValue({ ok: true }),
    deleteMenu: vi.fn().mockResolvedValue({ ok: true }),
    shiftPages: vi.fn().mockResolvedValue({ ok: true }),
    moveBlock: vi.fn().mockResolvedValue({ ok: true }),
    deletePage: vi.fn().mockResolvedValue({ ok: true }),
    titleOf: (page: number) => titles[page] ?? '',
    descriptionOf: () => '',
    savePageText: vi.fn().mockReturnValue({ ok: true }),
    occupiedPages: [204, 412, 712],
    handMadePages: [412, 712],
    ...overrides,
  };
}

/** Reports the current URL so the tab parameter can be asserted. */
function UrlProbe() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderManage(url = '/manage') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ManageArchivePage />
      <UrlProbe />
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId('url').textContent;
const onAirTab = () => screen.getByRole('tab', { name: /on air/i });
const archiveTab = () => screen.getByRole('tab', { name: /archive/i });

beforeEach(() => {
  admin = { admin: true, loading: false, configured: true };
  connectionStatus = 'connected';
  kinds = {};
  lastInput = null;
  data = makeData();
  setKind.mockReset();
});

describe('the auth gate', () => {
  it('says it is checking while the answer is unknown, and shows no tabs', () => {
    admin = { admin: false, loading: true, configured: true };
    renderManage();

    expect(screen.getByText(/checking sign-in/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText(/go to sign-in/i)).not.toBeInTheDocument();
  });

  it('prompts a non-moderator to sign in, and shows no tabs', () => {
    admin = { admin: false, loading: false, configured: true };
    renderManage();

    expect(screen.getByText(/sign in as moderator/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });
});

describe('which tab is selected', () => {
  it('opens On Air with no tab parameter, and leaves the URL bare', () => {
    renderManage();

    expect(onAirTab()).toHaveAttribute('aria-selected', 'true');
    expect(archiveTab()).toHaveAttribute('aria-selected', 'false');
    // Nothing was wrong with the URL, so nothing is rewritten.
    expect(url()).toBe('/manage');
  });

  it('opens the tab the URL names, unchanged', () => {
    renderManage('/manage?tab=archive');

    expect(archiveTab()).toHaveAttribute('aria-selected', 'true');
    expect(url()).toBe('/manage?tab=archive');
  });

  it.each(['ARCHIVE', 'Archive', 'on_air', ''])(
    'falls back to On Air for %o and rewrites the URL',
    async (value) => {
      renderManage(`/manage?tab=${value}`);

      expect(onAirTab()).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(url()).toBe('/manage?tab=on-air'));
    },
  );

  it('keeps other query parameters when it writes the tab', async () => {
    const user = userEvent.setup();
    renderManage('/manage?keep=yes');

    await user.click(archiveTab());
    await waitFor(() => expect(url()).toContain('keep=yes'));
    expect(url()).toContain('tab=archive');
  });

  it('renders only the selected panel', async () => {
    const user = userEvent.setup();
    renderManage();

    // On Air is showing: its filter exists and the capture search does not.
    expect(screen.getByLabelText(/find a page/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/search titles and filenames/i)).toBeNull();

    await user.click(archiveTab());

    expect(screen.getByLabelText(/search titles and filenames/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/find a page/i)).toBeNull();
  });

  it('points the tab and its panel at each other', async () => {
    const user = userEvent.setup();
    renderManage();

    const panel = screen.getByRole('tabpanel');
    expect(onAirTab()).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', onAirTab().id);
    // The unselected tab has no panel to point at.
    expect(archiveTab()).not.toHaveAttribute('aria-controls');

    await user.click(archiveTab());
    expect(onAirTab()).not.toHaveAttribute('aria-controls');
  });
});

describe('the tab strip from the keyboard', () => {
  it('holds one tab stop, being the selected tab', () => {
    renderManage();

    expect(onAirTab()).toHaveAttribute('tabindex', '0');
    expect(archiveTab()).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus with the arrows, wrapping at both ends', async () => {
    const user = userEvent.setup();
    renderManage();

    onAirTab().focus();
    await user.keyboard('{ArrowRight}');

    expect(archiveTab()).toHaveFocus();
    expect(archiveTab()).toHaveAttribute('aria-selected', 'true');

    // Wraps round rather than stopping.
    await user.keyboard('{ArrowRight}');
    expect(onAirTab()).toHaveFocus();
    expect(onAirTab()).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(archiveTab()).toHaveFocus();
  });

  it('sends Home to the first tab and End to the last', async () => {
    const user = userEvent.setup();
    renderManage('/manage?tab=archive');

    archiveTab().focus();
    await user.keyboard('{Home}');
    expect(onAirTab()).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(archiveTab()).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves the tab selected on Enter, since activation follows focus', async () => {
    const user = userEvent.setup();
    renderManage();

    onAirTab().focus();
    await user.keyboard('{Enter}');
    expect(onAirTab()).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the tab labels', () => {
  it('counts each range separately', () => {
    renderManage();
    // 204 and 412 are curated; 712 is playground.
    expect(onAirTab()).toHaveAccessibleName(/2 in 100–699/);
    expect(onAirTab()).toHaveAccessibleName(/1 in 700–999/);
  });

  it('omits the counts until the live document has synced', () => {
    connectionStatus = 'disconnected';
    renderManage();

    expect(onAirTab()).not.toHaveAccessibleName(/in 100–699/);
  });

  it('omits the capture count until the archive has been opened', async () => {
    const user = userEvent.setup();
    data = makeData({ total: 128 });
    renderManage();

    expect(archiveTab()).not.toHaveAccessibleName(/captures match/);

    await user.click(archiveTab());
    expect(archiveTab()).toHaveAccessibleName(/128 captures match/);
  });
});

describe('what gets fetched', () => {
  it('does not enable the corpus queries until the archive is opened', async () => {
    const user = userEvent.setup();
    renderManage();

    expect(lastInput).toMatchObject({ admin: true, archiveEnabled: false });

    await user.click(archiveTab());
    expect(lastInput).toMatchObject({ archiveEnabled: true });

    // Going back does not switch them off again — the results are kept.
    await user.click(onAirTab());
    expect(lastInput).toMatchObject({ archiveEnabled: true });
  });
});

describe('one action at a time, per page', () => {
  /** A page action that stays in flight until the test lets it finish. */
  function pendingAction() {
    let release: (value: { ok: true }) => void = () => {};
    const promise = new Promise<{ ok: true }>((resolve) => {
      release = resolve;
    });
    return { promise, release: () => release({ ok: true }) };
  }

  it('disables the acting page and leaves every other page alone', async () => {
    const user = userEvent.setup();
    const pending = pendingAction();
    data = makeData({ moveBlock: vi.fn().mockReturnValue(pending.promise) });
    renderManage();

    const cards = screen.getAllByRole('listitem');
    const first = within(cards[0]);
    const second = within(cards[1]);

    await user.click(first.getByRole('button', { name: /move page 204 to 205/i }));

    // The acting card says what it is doing and its controls are unavailable.
    expect(first.getByText(/moving…/i)).toBeInTheDocument();
    expect(first.getByRole('button', { name: /^Delete$/ })).toBeDisabled();
    // The other card is untouched, which is the whole point of the change.
    expect(second.getByRole('button', { name: /^Delete$/ })).toBeEnabled();

    pending.release();
    await waitFor(() =>
      expect(first.getByRole('button', { name: /^Delete$/ })).toBeEnabled(),
    );
  });

  it('moves a page to the number the operator names, and says where it went', async () => {
    const user = userEvent.setup();
    renderManage();

    const card = within(screen.getAllByRole('listitem')[0]);
    await user.click(card.getByRole('button', { name: /renumber page 204/i }));

    const field = card.getByLabelText(/new number for page 204/i);
    await user.clear(field);
    await user.type(field, '305');
    await user.click(card.getByRole('button', { name: /^Move$/ }));

    // A block move of one — the only move primitive the server has.
    await waitFor(() => expect(data.moveBlock).toHaveBeenCalledWith(204, 204, 305));

    // Reported in both places, in the same words: the notice line, which scrolls
    // away, and the card, which is where the operator was looking. And naming the
    // destination rather than the old number, since 204 is no longer this page.
    await waitFor(() =>
      expect(screen.getAllByText(/page 204 is now 305/i)).toHaveLength(2),
    );
    // The field closes, because the card under 204 is a different page now.
    expect(card.queryByLabelText(/new number for page 204/i)).toBeNull();
  });

  it('reports a success through status and a failure through alert', async () => {
    const user = userEvent.setup();
    data = makeData({
      moveBlock: vi.fn().mockResolvedValue({ ok: false, error: 'Nope.' }),
    });
    renderManage();

    const cards = screen.getAllByRole('listitem');
    await user.click(
      within(cards[0]).getByRole('button', { name: /move page 204 to 205/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/page 204/i),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Nope\./);
  });

  it('re-enables the page after a rejection rather than leaving it stuck', async () => {
    const user = userEvent.setup();
    data = makeData({
      moveBlock: vi.fn().mockRejectedValue(new Error('Network gone.')),
    });
    renderManage();

    const cards = screen.getAllByRole('listitem');
    const first = within(cards[0]);
    await user.click(first.getByRole('button', { name: /move page 204 to 205/i }));

    await waitFor(() =>
      expect(first.getByRole('button', { name: /^Delete$/ })).toBeEnabled(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Network gone\./);
  });
});

describe('confirming what cannot be undone', () => {
  it('asks before deleting, naming the page and its title', async () => {
    const user = userEvent.setup();
    renderManage();

    const cards = screen.getAllByRole('listitem');
    await user.click(within(cards[0]).getByRole('button', { name: /^Delete$/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/delete page 204/i);
    expect(dialog).toHaveTextContent(/Noticias/);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    // Focus starts on the control that does nothing.
    expect(within(dialog).getByRole('button', { name: /keep the page/i })).toHaveFocus();
    expect(data.deletePage).not.toHaveBeenCalled();
  });

  it('offers no separate unpublish, since delete is the one way off air', () => {
    renderManage();

    // On a published page unpublish did exactly what delete does — clear the
    // record, the content, the title, the description and the directory role —
    // so it was two names and two confirmations for one action.
    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).queryByRole('button', { name: /unpublish/i })).toBeNull();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderManage();

    const cards = screen.getAllByRole('listitem');
    await user.click(within(cards[0]).getByRole('button', { name: /^Delete$/ }));

    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: /keep the page/i });
    const confirm = within(dialog).getByRole('button', { name: /delete the page/i });

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
  });

  it('cancels on Escape, changing nothing', async () => {
    const user = userEvent.setup();
    renderManage();

    const cards = screen.getAllByRole('listitem');
    await user.click(within(cards[0]).getByRole('button', { name: /^Delete$/ }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(data.deletePage).not.toHaveBeenCalled();
  });

  it('performs the action once when confirmed', async () => {
    const user = userEvent.setup();
    renderManage();

    const cards = screen.getAllByRole('listitem');
    await user.click(within(cards[0]).getByRole('button', { name: /^Delete$/ }));
    await user.click(screen.getByRole('button', { name: /delete the page/i }));

    await waitFor(() => expect(data.deletePage).toHaveBeenCalledTimes(1));
    expect(data.deletePage).toHaveBeenCalledWith(204);
  });
});
