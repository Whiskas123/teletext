// Feature: manage workspace — the /manage screen driven end to end on the
// in-memory backend. Verifies: the list with its free numbers, selection by
// click / Shift / Cmd, the details pane saving on blur, bulk edits, moving by
// keyboard and by drag, merging by dropping onto a page, deleting only after
// confirmation, adding archive captures, and the tabs and their old URLs.

import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ManageWorkspace } from './ManageWorkspace';
import { fakeCapture, useFakeManageDeps, type FakeSeed } from './testing/useFakeManageDeps';
import { useArchiveQuery } from './useArchiveQuery';
import { useManageTab } from './useManageTab';

// jsdom has no DragEvent, and without one Testing Library falls back to a
// plain Event and drops `clientY` — which is what decides before, onto or
// after. A MouseEvent carries it.
if (typeof window.DragEvent === 'undefined') {
  class DragEventPolyfill extends MouseEvent {
    dataTransfer: DataTransfer | null = null;
  }
  (window as unknown as { DragEvent: typeof DragEventPolyfill }).DragEvent = DragEventPolyfill;
}

// A canvas per row is noise in jsdom, which cannot draw one anyway.
vi.mock('../TeletextGrid/TeletextThumbnail', () => ({
  TeletextThumbnail: () => <span data-testid="thumb" />,
}));

const SEED: FakeSeed = {
  menus: [
    {
      id: 1,
      name: 'Main navigation',
      items: [
        { label: 'INDICE', pageNumber: 100 },
        { label: 'NEWS', pageNumber: 200 },
        { label: '', pageNumber: null },
        { label: '', pageNumber: null },
      ],
    },
  ],
  pages: [
    { pageNumber: 100, title: 'Index', kind: 'category', captureIds: [1] },
    { pageNumber: 150 },
    { pageNumber: 200, title: 'News', kind: 'category', captureIds: [2] },
    { pageNumber: 201, title: 'Story one', captureIds: [3] },
    { pageNumber: 202, title: 'Story two', captureIds: [4, 5], screens: 2 },
    { pageNumber: 203, title: 'Story three' },
    { pageNumber: 300, title: 'Sport', kind: 'category' },
    { pageNumber: 710, title: 'Visitor page' },
  ],
  captures: [
    fakeCapture(9001, 220, 'Lisboa'),
    fakeCapture(9002, 221, 'Porto'),
    { ...fakeCapture(9003, 222, 'Faro'), source: 'rtp' as const },
    // Page 222 again, a year later: the same slot, folded behind the newer one.
    { ...fakeCapture(9004, 222, 'Faro again'), source: 'rtp' as const, first_seen: '2004-05-10', last_seen: '2004-06-02' },
    // A three-screen SIC story: no titles in the manifest, as with all of SIC.
    ...[1, 2, 3].map((sub) => ({
      ...fakeCapture(9100 + sub, 571, ''),
      source: 'sic' as const,
      sub: `000${sub}`,
      sub_index: sub,
      manifest_title: null,
    })),
  ],
};

let location = '';
function LocationProbe() {
  const where = useLocation();
  useEffect(() => {
    location = `${where.pathname}${where.search}`;
  }, [where]);
  return null;
}

function Harness({ seed }: { seed: FakeSeed }) {
  const tab = useManageTab();
  const query = useArchiveQuery(tab.initialArchive);
  const deps = useFakeManageDeps(seed, query.queryFilters);
  return <ManageWorkspace deps={deps} tab={tab} query={query} />;
}

function renderWorkspace(url = '/manage', seed: FakeSeed = SEED) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Harness seed={seed} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { user, table: screen.getByRole('grid', { name: 'Pages' }) };
}

// Collapsed headings are remembered in the browser; each test starts expanded.
beforeEach(() => localStorage.clear());

const row = (page: number) => document.querySelector<HTMLElement>(`[data-page="${page}"]`)!;
const titleAt = (page: number) => row(page)?.querySelector('.mg-title')?.textContent;

/** A drag the way the browser delivers one, with a data transfer to write to. */
function drag(from: HTMLElement, to: HTMLElement, clientY: number) {
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer, clientY });
  fireEvent.drop(to, { dataTransfer, clientY });
  fireEvent.dragEnd(from, { dataTransfer });
}
// jsdom rows measure 0×0, so the zone is decided by clientY alone:
// 0 is the top edge ("before"), 0.5 the middle ("onto"), 1 the bottom ("after").
const BEFORE = 0;
const ONTO = 0.5;
const AFTER = 1;

describe('the page list', () => {
  it('lists pages in number order with the free numbers between them', () => {
    renderWorkspace();
    const numbers = [...document.querySelectorAll<HTMLElement>('[data-page]')].map((el) => el.dataset.page);
    expect(numbers).toEqual(['100', '150', '200', '201', '202', '203', '300', '710']);
    expect(screen.getByText('101–149')).toBeInTheDocument();
    expect(screen.getByText('204–299')).toBeInTheDocument();
    // Headings are marked, archive pages name their source, hand-made ones say so.
    expect(within(row(200)).getByText('Category')).toBeInTheDocument();
    expect(within(row(201)).getByText(/RTP 201/)).toBeInTheDocument();
    expect(within(row(203)).getByText('Hand-made')).toBeInTheDocument();
  });

  it('filters by number or title, and says how many are shown', async () => {
    const { user } = renderWorkspace();
    await user.type(screen.getByRole('searchbox', { name: 'Filter pages' }), 'story');
    const numbers = [...document.querySelectorAll<HTMLElement>('[data-page]')].map((el) => el.dataset.page);
    expect(numbers).toEqual(['201', '202', '203']);
    expect(screen.queryByText('204–299')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear · 3 of 8/ })).toBeInTheDocument();
  });

  it('selects one row on click, a range on Shift-click, and toggles on Cmd-click', async () => {
    const { user } = renderWorkspace();
    await user.click(row(200));
    expect(row(200)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Shift>}');
    await user.click(row(203));
    await user.keyboard('{/Shift}');
    for (const page of [200, 201, 202, 203]) expect(row(page)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('toolbar', { name: 'Selected pages' })).toHaveTextContent('4 selected');

    await user.keyboard('{Meta>}');
    await user.click(row(201));
    await user.keyboard('{/Meta}');
    expect(row(201)).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('toolbar', { name: 'Selected pages' })).toHaveTextContent('3 selected');
  });
});

describe('the details pane', () => {
  it('saves the title when the field is left, and Escape abandons an edit', async () => {
    const { user } = renderWorkspace();
    await user.click(row(201));
    const pane = screen.getByRole('complementary', { name: 'Page 201' });
    const title = within(pane).getByRole('textbox', { name: 'Title' });

    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.tab();
    await waitFor(() => expect(titleAt(201)).toBe('Renamed'));

    await user.click(title);
    await user.type(title, ' nope');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(title).not.toHaveFocus());
    expect(titleAt(201)).toBe('Renamed');
  });

  it('moves a page to a typed number, previewing who else is renumbered', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    const pane = screen.getByRole('complementary', { name: 'Page 203' });
    await user.type(within(pane).getByRole('textbox', { name: 'Move to number' }), '201');
    expect(within(pane).getByText(/Page 203 becomes 201\. Also renumbers 201→202, 202→203\./)).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(titleAt(201)).toBe('Story three'));
    expect(titleAt(202)).toBe('Story one');
    expect(titleAt(203)).toBe('Story two');
    // The selection went with the page.
    expect(row(201)).toHaveAttribute('aria-selected', 'true');
  });

  it('changes the bottom bar of every archive screen of the page', async () => {
    const { user } = renderWorkspace();
    await user.click(row(202));
    const pane = screen.getByRole('complementary', { name: 'Page 202' });
    await user.selectOptions(within(pane).getByRole('combobox', { name: /Last row of all 2 archive screens/ }), 'Main navigation');
    await waitFor(() => expect(row(202).querySelector('.mg-col-bar')).toHaveTextContent('Main navigation'));
    expect(screen.getByText('2 screens on 1 page re-published.')).toBeInTheDocument();
  });

  it('has no bar to choose on a hand-made page', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    const pane = screen.getByRole('complementary', { name: 'Page 203' });
    expect(within(pane).getByText(/Made by hand, so its bottom row is whatever was drawn/)).toBeInTheDocument();
  });
});

describe('several pages at once', () => {
  it('sets the role on every selected page', async () => {
    const { user } = renderWorkspace();
    await user.click(row(201));
    await user.keyboard('{Shift>}');
    await user.click(row(203));
    await user.keyboard('{/Shift}');
    const pane = screen.getByRole('complementary', { name: '3 pages selected' });
    await user.selectOptions(within(pane).getByRole('combobox', { name: 'Directory role' }), 'Subcategory heading');
    for (const page of [201, 202, 203]) {
      expect(within(row(page)).getByText('Subcategory')).toBeInTheDocument();
    }
  });

  it('deletes only after confirming, and Cancel keeps everything', async () => {
    const { user, table } = renderWorkspace();
    await user.click(row(201));
    await user.keyboard('{Shift>}');
    await user.click(row(202));
    await user.keyboard('{/Shift}');
    table.focus();
    fireEvent.keyDown(row(202), { key: 'Delete' });

    const dialog = screen.getByRole('dialog', { name: 'Delete 2 pages?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(row(201)).toBeInTheDocument();

    fireEvent.keyDown(row(202), { key: 'Delete' });
    await user.click(screen.getByRole('button', { name: 'Delete 2 pages' }));
    await waitFor(() => expect(row(201)).toBeNull());
    expect(row(202)).toBeNull();
    expect(screen.getByText('2 pages deleted (201–202).')).toBeInTheDocument();
  });
});

describe('moving pages', () => {
  it('Alt+↓ trades places with the next number, keeping the page selected', async () => {
    const { user } = renderWorkspace();
    await user.click(row(201));
    fireEvent.keyDown(row(201), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(titleAt(201)).toBe('Story two'));
    expect(titleAt(202)).toBe('Story one');
    expect(row(202)).toHaveAttribute('aria-selected', 'true');
  });

  it('Alt+↓ steps into a free number rather than jumping the gap', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    fireEvent.keyDown(row(203), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(titleAt(204)).toBe('Story three'));
    expect(row(203)).toBeNull();
  });

  it('a drag inside a section reorders it and keeps its numbers', async () => {
    renderWorkspace();
    drag(row(201), row(203), AFTER);
    await waitFor(() => expect(titleAt(203)).toBe('Story one'));
    expect(titleAt(201)).toBe('Story two');
    expect(titleAt(202)).toBe('Story three');
    expect(titleAt(300)).toBe('Sport');
  });

  it('a drag into another section places the page and pushes only what is in the way', async () => {
    renderWorkspace();
    drag(row(203), row(300), BEFORE);
    await waitFor(() => expect(titleAt(299)).toBe('Story three'));
    expect(titleAt(300)).toBe('Sport');
  });

  it('dropping onto a page asks, then folds it in as screens', async () => {
    const { user } = renderWorkspace();
    drag(row(203), row(201), ONTO);
    const dialog = screen.getByRole('dialog', { name: 'Merge into page 201?' });
    expect(dialog).toHaveTextContent('Page 203 moves to subpage 2 of page 201, and 203 is left empty.');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(row(203)).toBeNull());
    expect(within(row(201)).getByRole('button', { name: /Show the 2 screens of page 201/ })).toBeInTheDocument();
  });

  it('closes a gap by moving every later page up, after asking', async () => {
    const { user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Close the gap at 204–299' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the gap at 204–299?' });
    expect(dialog).toHaveTextContent('Page 300 becomes 204.');

    await user.click(within(dialog).getByRole('button', { name: 'Move page up' }));
    await waitFor(() => expect(titleAt(204)).toBe('Sport'));
    expect(row(300)).toBeNull();
    // The playground is its own range and stays put.
    expect(titleAt(710)).toBe('Visitor page');
    // Nothing after the last page of a range to close.
    expect(screen.queryByRole('button', { name: /Close the gap at 205–699/ })).toBeNull();
  });

  it('refuses to drag an archive page into the playground', () => {
    renderWorkspace();
    drag(row(201), row(710), AFTER);
    expect(titleAt(201)).toBe('Story one');
    expect(row(711)).toBeNull();
  });
});

describe('adding from the archive', () => {
  it('picks captures in order and adds them as new pages after the selected one', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    await user.click(screen.getByRole('button', { name: '+ Add from archive' }));
    const pane = screen.getByRole('complementary', { name: 'Archive' });

    await user.click(within(pane).getByRole('button', { name: 'Pick RTP 221' }));
    await user.click(within(pane).getByRole('button', { name: 'Pick RTP 220' }));
    expect(within(pane).getByText('Adds 2 pages at 204–205. Nothing else is renumbered.')).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Add 2 pages' }));

    // In the order picked, not the order shown.
    await waitFor(() => expect(titleAt(204)).toBe('Porto'));
    expect(titleAt(205)).toBe('Lisboa');
    expect(screen.getByText('Added 2 pages at 204–205.')).toBeInTheDocument();
  });

  it('adds captures as more screens of a page', async () => {
    const { user } = renderWorkspace();
    await user.click(row(201));
    await user.click(screen.getByRole('button', { name: '+ From archive' }));
    const pane = screen.getByRole('complementary', { name: 'Archive' });
    await user.click(within(pane).getByRole('button', { name: 'Pick RTP 220' }));
    expect(within(pane).getByText('Adds screen 2 to page 201.')).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Add 1 screen' }));
    await waitFor(() =>
      expect(within(row(201)).getByRole('button', { name: /Show the 2 screens of page 201/ })).toBeInTheDocument(),
    );
    // A screen is not a retitling.
    expect(titleAt(201)).toBe('Story one');
  });

  it('opens with the archive pane for an old ?tab=archive link, and rewrites it', () => {
    renderWorkspace('/manage?tab=archive');
    expect(screen.getByRole('complementary', { name: 'Archive' })).toBeInTheDocument();
    expect(location).toBe('/manage?tab=pages');
  });
});

describe('working through the archive', () => {
  it('hides what is already published, so the list is what is left to do', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    await user.click(screen.getByRole('button', { name: '+ Add from archive' }));
    const pane = screen.getByRole('complementary', { name: 'Archive' });
    expect(within(pane).getByRole('checkbox', { name: 'Hide published' })).toBeChecked();

    await user.click(within(pane).getByRole('button', { name: 'Pick RTP 220' }));
    await user.click(within(pane).getByRole('button', { name: 'Add 1 page' }));
    await waitFor(() => expect(titleAt(204)).toBe('Lisboa'));
    expect(within(pane).queryByRole('button', { name: 'Pick RTP 220' })).toBeNull();

    // Shown again, with where it went, once published captures are let back in.
    await user.click(within(pane).getByRole('checkbox', { name: 'Hide published' }));
    expect(within(pane).getByText('On 204')).toBeInTheDocument();
    // And the next add would go straight after the last one.
    await user.click(within(pane).getByRole('button', { name: 'Pick RTP 221' }));
    expect(within(pane).getByRole('textbox', { name: 'Starting at' })).toHaveValue('205');
  });

  it('picks a whole story and adds it as one page of screens, titled from its text', async () => {
    const { user } = renderWorkspace();
    await user.click(row(203));
    await user.click(screen.getByRole('button', { name: '+ Add from archive' }));
    const pane = screen.getByRole('complementary', { name: 'Archive' });

    const tile = within(pane).getByRole('button', { name: 'Pick SIC 571-0002' }).closest('li')!;
    await user.click(within(tile).getByRole('button', { name: /Whole story · 3/ }));
    expect(within(pane).getByRole('radio', { name: 'One page, as screens' })).toBeChecked();
    expect(within(pane).getByText(/Adds page 204 with 3 screens, in the order picked\./)).toBeInTheDocument();

    await user.click(within(pane).getByRole('button', { name: 'Add 1 page with 3 screens' }));
    await waitFor(() => expect(titleAt(204)).toBe('Capture 9101'));
    expect(within(row(204)).getByRole('button', { name: /Show the 3 screens of page 204/ })).toBeInTheDocument();
  });

  it('finds untitled pages and titles them from their own text', async () => {
    const { user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Untitled · 1' }));
    const numbers = [...document.querySelectorAll<HTMLElement>('[data-page]')].map((el) => el.dataset.page);
    expect(numbers).toEqual(['150']);

    await user.click(row(150));
    const pane = screen.getByRole('complementary', { name: 'Page 150' });
    await user.click(within(pane).getByRole('button', { name: 'Suggest' }));
    const title = within(pane).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveFocus();
    expect((title as HTMLInputElement).value).toMatch(/^lorem ipsum/);
    await user.keyboard('{Enter}');
    // Titled, it leaves the untitled view — which is the point of the view.
    await waitFor(() => expect(row(150)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Untitled · 0' }));
    expect(titleAt(150)).toMatch(/^lorem ipsum/);
  });

  it('fills every missing title in a selection at once, leaving titled pages alone', async () => {
    const { user } = renderWorkspace();
    await user.click(row(100));
    await user.keyboard('{Shift>}');
    await user.click(row(200));
    await user.keyboard('{/Shift}');
    const pane = screen.getByRole('complementary', { name: '3 pages selected' });
    expect(within(pane).getByText('1 of these has no title.')).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Fill in from page text' }));
    await waitFor(() => expect(titleAt(150)).toMatch(/^lorem ipsum/));
    expect(titleAt(100)).toBe('Index');
    expect(screen.getByText('1 page given a title from its own text.')).toBeInTheDocument();
  });
});

describe('the old publication records', () => {
  // 250 was published, then emptied in the editor, while the record still sat
  // in the old table. 203 is on air with its record not yet moved in.
  const OLD: FakeSeed = {
    ...SEED,
    pages: [
      ...SEED.pages.filter((page) => page.pageNumber !== 203),
      { pageNumber: 203, title: 'Story three', captureIds: [9003], legacy: true },
      { pageNumber: 250, title: 'Old story', captureIds: [77], stranded: true },
    ],
  };

  it('no longer block numbers: a gap closes straight through an empty record', async () => {
    // What failed on the live site before: the record at 250 made the server
    // refuse a move the page list had shown as fine.
    const { user } = renderWorkspace('/manage', OLD);
    expect(row(250)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close the gap at 204–299' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Move page up' }),
    );
    await waitFor(() => expect(titleAt(204)).toBe('Sport'));
  });

  it('move in beside their pages, without changing what is on air', async () => {
    const { user } = renderWorkspace('/manage', OLD);
    const panel = screen.getByRole('region', { name: 'Old publication records' });
    expect(within(row(203)).getByText('Hand-made')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Move 1 in' }));
    await waitFor(() => expect(within(row(203)).queryByText('Hand-made')).toBeNull());
    expect(titleAt(203)).toBe('Story three');
    expect(screen.getByText('1 record moved into the live pages.')).toBeInTheDocument();
  });

  it('pointing at empty screens can be restored from the archive, or set aside', async () => {
    const { user } = renderWorkspace('/manage', OLD);
    const panel = screen.getByRole('region', { name: 'Old publication records' });
    await user.click(within(panel).getByRole('button', { name: 'Show them' }));
    expect(within(panel).getByText('Old story')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(titleAt(250)).toBe('Old story'));
    expect(screen.getByText('1 screen restored from the archive.')).toBeInTheDocument();
  });
});

describe('pages edited by hand since publishing', () => {
  const EDITED: FakeSeed = {
    ...SEED,
    pages: SEED.pages.map((page) => (page.pageNumber === 201 ? { ...page, edited: true } : page)),
  };

  it('are marked, and changing their bar asks first because it undoes the edits', async () => {
    const { user } = renderWorkspace('/manage', EDITED);
    expect(within(row(201)).getByText(/edited/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edited · 1' })).toBeInTheDocument();

    await user.click(row(201));
    const pane = screen.getByRole('complementary', { name: 'Page 201' });
    await user.selectOptions(within(pane).getByRole('combobox', { name: /Last row/ }), 'Main navigation');
    const dialog = screen.getByRole('dialog', { name: 'Page 201 was edited by hand' });

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(row(201).querySelector('.mg-col-bar')).not.toHaveTextContent('Main navigation');

    await user.selectOptions(within(pane).getByRole('combobox', { name: /Last row/ }), 'Main navigation');
    await user.click(screen.getByRole('button', { name: 'Publish again from the archive' }));
    await waitFor(() => expect(row(201).querySelector('.mg-col-bar')).toHaveTextContent('Main navigation'));
    expect(within(row(201)).queryByText(/edited/)).toBeNull();
  });
});

describe('collapsing sections', () => {
  const shown = () => [...document.querySelectorAll<HTMLElement>('[data-page]')].map((el) => Number(el.dataset.page));

  it('hides the pages a heading owns, and says how many', async () => {
    const { user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Hide the 3 pages under 200' }));
    expect(shown()).toEqual([100, 150, 200, 300, 710]);
    expect(within(row(200)).getByText('3 pages')).toBeInTheDocument();
    // The free numbers inside the section go with it; the gap after it stays.
    expect(screen.getByText('204–299')).toBeInTheDocument();

    // → opens it again from the keyboard.
    await user.click(row(200));
    fireEvent.keyDown(row(200), { key: 'ArrowRight' });
    expect(shown()).toContain(201);
  });

  it('drags a collapsed heading as its whole section, and keeps it collapsed', async () => {
    const { user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Hide the 3 pages under 200' }));
    drag(row(200), row(300), AFTER);
    await waitFor(() => expect(titleAt(301)).toBe('News'));
    expect(shown()).toEqual([100, 150, 300, 301, 710]);
    expect(within(row(301)).getByText('3 pages')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the 3 pages under 301' }));
    expect(titleAt(302)).toBe('Story one');
    expect(titleAt(304)).toBe('Story three');
  });

  it('collapses and expands everything at once, and shows everything while filtering', async () => {
    const { user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(shown()).toEqual([100, 200, 300, 710]);
    await user.type(screen.getByRole('searchbox', { name: 'Filter pages' }), 'story');
    expect(shown()).toEqual([201, 202, 203]);
    await user.clear(screen.getByRole('searchbox', { name: 'Filter pages' }));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(shown()).toContain(150);
  });
});

describe('one capture per page', () => {
  it('folds other days of a page behind the newest, one click from showing them', async () => {
    const { user } = renderWorkspace();
    // The toolbar's button; the empty details pane offers the same one.
    await user.click(screen.getAllByRole('button', { name: '+ Add from archive' })[0]);
    const pane = screen.getByRole('complementary', { name: 'Archive' });
    expect(within(pane).queryByText('Faro')).toBeNull();
    const tile = within(pane).getByText('Faro again').closest('li')!;

    await user.click(within(tile).getByRole('button', { name: '+1 other day' }));
    expect(within(pane).getByRole('checkbox', { name: 'One per page' })).not.toBeChecked();
    expect(within(pane).getByText('Faro')).toBeInTheDocument();
    expect(within(pane).getByText('Faro again')).toBeInTheDocument();
    // Narrowed to that page, so nothing else is in the way.
    expect(within(pane).queryByText('Lisboa')).toBeNull();
  });
});

describe('the tabs', () => {
  it('moves between tabs with the arrow keys and keeps the URL in step', async () => {
    const { user } = renderWorkspace();
    const pages = screen.getByRole('tab', { name: /Pages/ });
    pages.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Front page/ })).toHaveAttribute('aria-selected', 'true');
    expect(location).toBe('/manage?tab=front');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Bottom bars/ })).toHaveFocus();
    expect(screen.getByText('Main navigation')).toBeInTheDocument();
  });

  it('edits a bottom bar and offers to re-publish the pages wearing it', async () => {
    const { user } = renderWorkspace();
    await user.click(row(202));
    await user.selectOptions(
      within(screen.getByRole('complementary', { name: 'Page 202' })).getByRole('combobox', { name: /Last row/ }),
      'Main navigation',
    );
    await waitFor(() => expect(row(202).querySelector('.mg-col-bar')).toHaveTextContent('Main navigation'));

    await user.click(screen.getByRole('tab', { name: /Bottom bars/ }));
    expect(screen.getByText('1 page · 2 screens')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const blue = screen.getByRole('textbox', { name: 'yellow label' });
    await user.type(blue, 'sport');
    expect(blue).toHaveValue('SPORT');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Re-publish 202' })).toBeInTheDocument();
  });
});
