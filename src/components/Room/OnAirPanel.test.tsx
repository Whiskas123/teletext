// Feature: manage-page-tabs — the On Air panel.
// Verifies: the two labelled groups, filtering by number and title, the two
// restrictions, the shown/total counter, the empty and no-match messages, the
// nudge guards, and that the reorder tools are absent when nothing is on air.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OnAirPanel, type OnAirPanelProps } from './OnAirPanel';
import { useOnAirState } from './useOnAirState';
import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import { EMPTY_REGISTRY, inFlightView } from '../../domain/inFlight';

function entry(pageNumber: number): PublishedEntry {
  return {
    page_number: pageNumber,
    capture_id: pageNumber,
    title: `Recorded ${pageNumber}`,
    description: '',
    published_at: '2001-06-11T00:00:00.000Z',
    source: 'rtp',
    original_page: 220,
    sub: '',
    topic: 'desporto',
    scheme: null,
    first_seen: null,
    manifest_title: null,
    shift_down: false,
    menu_id: null,
    menu_name: null,
  };
}

const TITLES: Record<number, string> = {
  204: 'Noticias',
  412: 'Desporto',
  413: '',
  712: 'Playground page',
};

/** Renders the panel with its own state hook, as the shell does. */
function Harness(overrides: Partial<OnAirPanelProps> = {}) {
  const state = useOnAirState();
  const published = new Map([[204, entry(204)]]);

  return (
    <OnAirPanel
      state={state}
      occupiedPages={[204, 412, 413, 712]}
      publicationsByPage={published}
      publicationsError={null}
      onRetryPublications={vi.fn()}
      inFlight={inFlightView(EMPTY_REGISTRY)}
      outcomes={new Map()}
      titleOf={(page) => TITLES[page] ?? ''}
      descriptionOf={() => ''}
      kindOf={() => 'page'}
      livePage={() => null}
      onNudge={vi.fn()}
      onMoveTo={vi.fn()}
      onUnpublish={vi.fn()}
      onDelete={vi.fn()}
      onSaveText={vi.fn()}
      onSetRole={vi.fn()}
      onShift={vi.fn().mockResolvedValue({ ok: true })}
      onMove={vi.fn().mockResolvedValue({ ok: true })}
      onNotice={vi.fn()}
      {...overrides}
    />
  );
}

const renderPanel = (overrides: Partial<OnAirPanelProps> = {}) =>
  render(<Harness {...overrides} />);

const filterInput = () => screen.getByLabelText(/find a page/i);
const shownPages = () =>
  screen
    .getAllByRole('listitem')
    .map((card) => within(card).getByText(/^\d{3}$/).textContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the two groups', () => {
  it('lists the curated range first, then the playground, each labelled', () => {
    renderPanel();

    const groups = screen.getAllByRole('region');
    expect(groups[0]).toHaveAccessibleName(/curated 100–699/i);
    expect(groups[1]).toHaveAccessibleName(/playground 700–999/i);
  });

  it('puts each page in its own group, ascending', () => {
    renderPanel();

    const groups = screen.getAllByRole('region');
    expect(
      within(groups[0]).getAllByRole('listitem').map((c) =>
        within(c).getByText(/^\d{3}$/).textContent,
      ),
    ).toEqual(['204', '412', '413']);
    expect(
      within(groups[1]).getAllByRole('listitem').map((c) =>
        within(c).getByText(/^\d{3}$/).textContent,
      ),
    ).toEqual(['712']);
  });

  it('marks a page as published or made by hand, and names its range', () => {
    renderPanel();

    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).getByText('Published')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/curated/i)).toBeInTheDocument();
    expect(within(cards[1]).getByText('Made by hand')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Playground 700–999')).toBeInTheDocument();
  });

  it('says when a page holds no content, and offers unpublish only where there is a record', () => {
    renderPanel();

    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).getByText(/holds no content/i)).toBeInTheDocument();
    expect(within(cards[0]).getByRole('button', { name: /unpublish/i })).toBeInTheDocument();
    expect(within(cards[1]).queryByRole('button', { name: /unpublish/i })).toBeNull();
  });
});

describe('finding a page', () => {
  it('filters by page number as a substring', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), '41');
    expect(shownPages()).toEqual(['412', '413']);
  });

  it('filters by title, ignoring case', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), 'DESPOR');
    expect(shownPages()).toEqual(['412']);
  });

  it('ignores whitespace around the term', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), '  204  ');
    expect(shownPages()).toEqual(['204']);
  });

  it('restricts to published pages, or to hand-made ones', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByLabelText(/^source$/i), 'published');
    expect(shownPages()).toEqual(['204']);

    await user.selectOptions(screen.getByLabelText(/^source$/i), 'hand-made');
    expect(shownPages()).toEqual(['412', '413', '712']);
  });

  it('restricts to one range', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByLabelText(/^range$/i), 'playground');
    expect(shownPages()).toEqual(['712']);
  });

  it('counts what is shown against the total, only while filtering', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByText(/of 4 shown/)).toBeNull();

    await user.type(filterInput(), '41');
    expect(screen.getByText(/2 of 4 shown/)).toBeInTheDocument();
  });

  it('names the restrictions in force', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByLabelText(/^range$/i), 'curated');
    expect(screen.getByText(/in 100–699/)).toBeInTheDocument();
  });

  it('says when nothing matches, naming the term, and clears on request', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), 'nothing-like-this');
    expect(screen.getByText(/no page on air is/i)).toHaveTextContent(
      /nothing-like-this/,
    );
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: /clear filter/i })[0]);
    expect(shownPages()).toHaveLength(4);
    // Focus goes back where the typing happens.
    expect(filterInput()).toHaveFocus();
  });

  it('accepts no more than 64 characters', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), 'x'.repeat(80));
    expect((filterInput() as HTMLInputElement).value).toHaveLength(64);
  });

  it('leaves the reorder tools alone while a filter hides pages', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(filterInput(), '712');
    // They take page numbers, not the shown list, so they stay usable.
    expect(screen.getByLabelText(/make room at page/i)).toBeEnabled();
  });
});

describe('an empty group, and an empty screen', () => {
  it('labels an empty group and says its range holds nothing', () => {
    renderPanel({ occupiedPages: [204] });

    const groups = screen.getAllByRole('region');
    expect(groups[1]).toHaveAccessibleName(/playground 700–999/i);
    expect(within(groups[1]).getByText(/no page in 700–999/i)).toBeInTheDocument();
  });

  it('omits the reorder tools entirely when no page holds content', () => {
    renderPanel({ occupiedPages: [] });

    expect(screen.getByText(/no page holds any content/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/make room at page/i)).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows the failure and a retry in place of the list, not an empty list', async () => {
    const user = userEvent.setup();
    const onRetryPublications = vi.fn();
    renderPanel({ publicationsError: 'Could not load.', onRetryPublications });

    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText(/no page holds any content/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /try loading/i }));
    expect(onRetryPublications).toHaveBeenCalledTimes(1);
  });
});

describe('the nudge arrows', () => {
  it('name the page and where it goes', () => {
    renderPanel();

    const cards = screen.getAllByRole('listitem');
    expect(
      within(cards[0]).getByRole('button', { name: 'Move page 204 to 203' }),
    ).toBeInTheDocument();
  });

  it('say when they will swap with an occupied neighbour rather than move into a gap', () => {
    renderPanel();

    const cards = screen.getAllByRole('listitem');
    // 413 is occupied, so nudging 412 up trades places with it.
    expect(
      within(cards[1]).getByRole('button', { name: 'Swap page 412 with page 413' }),
    ).toBeInTheDocument();
  });

  it('refuse to take a published page into the playground', () => {
    renderPanel({
      occupiedPages: [699],
      publicationsByPage: new Map([[699, entry(699)]]),
      titleOf: () => 'Last curated page',
    });

    const up = screen.getByRole('button', { name: /cannot move page 699 to 700/i });
    expect(up).toBeDisabled();
    expect(up).toHaveAttribute('title', expect.stringMatching(/open playground/i));
  });

  it('refuse to take a playground page into the curated range', () => {
    renderPanel({ occupiedPages: [700], publicationsByPage: new Map() });

    const down = screen.getByRole('button', { name: /cannot move page 700 to 699/i });
    expect(down).toBeDisabled();
    expect(down).toHaveAttribute('title', expect.stringMatching(/curated range/i));
  });

  it('still work on a playground page in the open direction', () => {
    renderPanel({ occupiedPages: [712], publicationsByPage: new Map() });

    // Playground pages keep their controls: this is the one range every visitor
    // can write to, so it is the one that most needs moderating.
    expect(screen.getByRole('button', { name: 'Move page 712 to 713' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Delete$/ })).toBeEnabled();
  });
});

describe('moving a page to a chosen number', () => {
  /** Open the "Move to…" control on the card at `index`. */
  async function openMover(
    user: ReturnType<typeof userEvent.setup>,
    index: number,
  ) {
    const card = within(screen.getAllByRole('listitem')[index]);
    await user.click(
      card.getByRole('button', { name: /renumber page \d+/i }),
    );
    return card;
  }

  it('opens a destination field pre-filled with the page it is on', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);
    expect(field).toHaveValue(204);
    expect(field).toHaveFocus();
  });

  it('opens on one page at a time', async () => {
    const user = userEvent.setup();
    renderPanel();

    await openMover(user, 0);
    await openMover(user, 1);

    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).queryByLabelText(/new number for page 204/i)).toBeNull();
    expect(within(cards[1]).getByLabelText(/new number for page 412/i)).toBeInTheDocument();
  });

  it('sends the page where it was told', async () => {
    const user = userEvent.setup();
    const onMoveTo = vi.fn();
    renderPanel({ onMoveTo });

    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);
    await user.clear(field);
    await user.type(field, '305');
    await user.click(card.getByRole('button', { name: /^Move$/ }));

    expect(onMoveTo).toHaveBeenCalledWith(204, 305);
  });

  it('accepts Enter as well as the button', async () => {
    const user = userEvent.setup();
    const onMoveTo = vi.fn();
    renderPanel({ onMoveTo });

    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);
    await user.clear(field);
    await user.type(field, '305{Enter}');

    expect(onMoveTo).toHaveBeenCalledWith(204, 305);
  });

  it('says what else will move before anything happens', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);

    // 412 and 413 lie between 204 and 500, so they come down to close the gap.
    // This is the part that is not obvious from a number box: page numbers are
    // positions, so moving one moves everything it passes.
    await user.clear(field);
    await user.type(field, '500');
    expect(card.getByText(/2 other pages shift/i)).toBeInTheDocument();
  });

  it('says when nothing else is disturbed', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Nothing sits above 712, so sending it to 999 moves it alone.
    const card = await openMover(user, 3);
    const field = card.getByLabelText(/new number for page 712/i);
    await user.clear(field);
    await user.type(field, '999');

    expect(card.getByText(/nothing else moves/i)).toBeInTheDocument();
  });

  it('refuses to leave the page where it already is', async () => {
    const user = userEvent.setup();
    const onMoveTo = vi.fn();
    renderPanel({ onMoveTo });

    const card = await openMover(user, 0);
    expect(card.getByText(/already there/i)).toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Move$/ })).toBeDisabled();
  });

  it('refuses a destination outside 100–999, saying so', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);
    await user.clear(field);
    await user.type(field, '42');

    expect(card.getByText(/between 100 and 999/i)).toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Move$/ })).toBeDisabled();
  });

  it('refuses to send a published page into the playground', async () => {
    const user = userEvent.setup();
    renderPanel();

    // 204 is the published one.
    const card = await openMover(user, 0);
    const field = card.getByLabelText(/new number for page 204/i);
    await user.clear(field);
    await user.type(field, '750');

    expect(card.getByText(/open playground/i)).toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Move$/ })).toBeDisabled();
  });

  it('allows a hand-made page out of the playground, and warns that it changes who may edit it', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = await openMover(user, 3);
    const field = card.getByLabelText(/new number for page 712/i);
    await user.clear(field);
    await user.type(field, '305');

    // The arrows refuse this because one keypress is too easy; naming 305 is
    // deliberate, so it goes ahead with a note.
    expect(card.getByText(/only a moderator/i)).toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Move$/ })).toBeEnabled();
  });

  it('closes without moving anything', async () => {
    const user = userEvent.setup();
    const onMoveTo = vi.fn();
    renderPanel({ onMoveTo });

    const card = await openMover(user, 0);
    await user.click(
      card.getByRole('button', { name: /cancel renumbering page 204/i }),
    );

    expect(card.queryByLabelText(/new number for page 204/i)).toBeNull();
    expect(onMoveTo).not.toHaveBeenCalled();
  });
});

describe('the inline editor', () => {
  it('opens with the stored values and marks unsaved changes', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = within(screen.getAllByRole('listitem')[1]);
    await user.click(card.getByRole('button', { name: /^Edit$/ }));

    const title = card.getByLabelText(/title \(/i);
    expect(title).toHaveValue('Desporto');
    expect(card.queryByText(/unsaved changes/i)).toBeNull();

    await user.type(title, '!');
    expect(card.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('discards back to the stored values', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = within(screen.getAllByRole('listitem')[1]);
    await user.click(card.getByRole('button', { name: /^Edit$/ }));
    await user.type(card.getByLabelText(/title \(/i), '!');
    await user.click(card.getByRole('button', { name: /discard/i }));

    expect(card.getByLabelText(/title \(/i)).toHaveValue('Desporto');
    expect(card.queryByText(/unsaved changes/i)).toBeNull();
  });

  it('hands the draft to the shell to save', async () => {
    const user = userEvent.setup();
    const onSaveText = vi.fn();
    renderPanel({ onSaveText });

    const card = within(screen.getAllByRole('listitem')[1]);
    await user.click(card.getByRole('button', { name: /^Edit$/ }));
    await user.clear(card.getByLabelText(/title \(/i));
    await user.type(card.getByLabelText(/title \(/i), 'Novo');
    await user.click(card.getByRole('button', { name: /^Save$/ }));

    expect(onSaveText).toHaveBeenCalledWith(412, {
      title: 'Novo',
      description: '',
    });
  });

  it('opens on one page at a time', async () => {
    const user = userEvent.setup();
    renderPanel();

    const cards = screen.getAllByRole('listitem');
    await user.click(within(cards[1]).getByRole('button', { name: /^Edit$/ }));
    await user.click(within(cards[2]).getByRole('button', { name: /^Edit$/ }));

    expect(within(cards[1]).queryByLabelText(/title \(/i)).toBeNull();
    expect(within(cards[2]).getByLabelText(/title \(/i)).toBeInTheDocument();
  });
});
