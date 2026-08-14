// Feature: the page directory's collapsible sections.
// Verifies: sections start closed, a heading opens and closes its own pages,
// and a heading is still a page you can dial.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { YellowPages } from './YellowPages';

// The directory measures its own columns to decide how many sheets it spills
// across, and jsdom has no ResizeObserver. A stub that never fires is right for
// these tests: nothing here resizes, and the sheet count is not what is under
// test.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

vi.mock('../../collab/useGuide', () => ({
  useGuide: () => ({
    entries: [
      { pageNumber: 100, title: 'Main Index' },
      { pageNumber: 200, title: 'TV Guide' },
      { pageNumber: 201, title: 'Tonight' },
      { pageNumber: 202, title: 'Tomorrow' },
      { pageNumber: 300, title: 'World News' },
      { pageNumber: 310, title: 'Europe' },
      { pageNumber: 311, title: 'Lisbon' },
      { pageNumber: 320, title: 'Asia' },
      { pageNumber: 321, title: 'Tokyo' },
    ],
  }),
}));

vi.mock('../../collab/usePageKinds', () => ({
  usePageKinds: () => ({
    // 300 is a category whose children are *subcategories*, not pages — the
    // shape that used to have nothing to collapse.
    kinds: {
      100: 'category',
      200: 'category',
      300: 'category',
      310: 'subcategory',
      320: 'subcategory',
    },
  }),
}));

const onSelect = vi.fn();
const onClose = vi.fn();

function renderDirectory() {
  return render(<YellowPages onSelect={onSelect} onClose={onClose} />);
}

describe('the page directory', () => {
  beforeEach(() => {
    onSelect.mockReset();
    onClose.mockReset();
  });

  it('opens with every section closed', () => {
    // The archive runs to hundreds of pages. A directory that shows all of them
    // at once is a wall to scroll rather than an index to read.
    renderDirectory();

    expect(screen.getByRole('button', { name: 'TV Guide, 3 pages' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument();
    expect(screen.queryByText('Tomorrow')).not.toBeInTheDocument();
  });

  it('says how many pages a closed section holds', () => {
    renderDirectory();
    // Three: the two pages under it, plus the TV Guide page itself. Without a
    // count a closed heading looks like an ordinary listing wearing a triangle.
    expect(
      screen.getByRole('button', { name: 'TV Guide, 3 pages' }),
    ).toHaveTextContent('3');
  });

  it('opens and closes one section without touching the others', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 3 pages' }));
    expect(screen.getByText('Tonight')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    // The neighbouring section stayed shut.
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 3 pages' }));
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument();
  });

  it('keeps a heading with a section dialable, because it is also a page', async () => {
    // 200 is the TV Guide index and a real page. Folding the toggle and the
    // page into one button would have meant losing one of them, so the title
    // opens the section and the number goes to the page.
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, page 200' }));
    expect(onSelect).toHaveBeenCalledWith(200);
  });

  it('sends a childless heading to its own page when the row is clicked', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: /Main Index/ }));
    expect(onSelect).toHaveBeenCalledWith(100);
  });

  it('requests the page when its number is chosen', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, page 200' }));
    expect(onSelect).toHaveBeenCalledWith(200);
    expect(onClose).toHaveBeenCalled();
  });

  it('collapses a category whose children are subcategories, not pages', async () => {
    // The bug this covers: a nested heading becomes a sibling block, so the
    // category's own block held nothing but itself. Its toggle appeared to do
    // nothing while the subcategories sat there in plain sight.
    const user = userEvent.setup();
    renderDirectory();

    expect(screen.queryByText('Europe')).not.toBeInTheDocument();
    expect(screen.queryByText('Asia')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'World News, 5 pages' }));
    expect(screen.getByText('Europe')).toBeInTheDocument();
    expect(screen.getByText('Asia')).toBeInTheDocument();
    // Opening a category does not open the subcategories inside it.
    expect(screen.queryByText('Lisbon')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'World News, 5 pages' }));
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();
  });

  it('closing a category takes its whole subtree with it', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'World News, 5 pages' }));
    await user.click(screen.getByRole('button', { name: 'Europe, 2 pages' }));
    expect(screen.getByText('Lisbon')).toBeInTheDocument();

    // Closing the grandparent hides the grandchild, not just the children.
    await user.click(screen.getByRole('button', { name: 'World News, 5 pages' }));
    expect(screen.queryByText('Lisbon')).not.toBeInTheDocument();
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();
  });

  it('counts the whole subtree, and the heading page itself', () => {
    renderDirectory();
    // World News: two subcategories, a page under each, and its own page = 5.
    expect(
      screen.getByRole('button', { name: 'World News, 5 pages' }),
    ).toBeInTheDocument();
  });

  it('gives a heading with nothing under it a count but no arrow', () => {
    // Main Index is a category and a real page, and there is nothing filed
    // under it — so the row goes to the page rather than opening an empty
    // section, and it still carries its count of one.
    renderDirectory();

    const mainIndex = screen.getByRole('button', { name: /Main Index/ });
    expect(mainIndex).not.toHaveAttribute('aria-expanded');
    expect(mainIndex).toHaveTextContent('1');
  });

  it('reaches a page inside a section once it is open', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 3 pages' }));
    await user.click(screen.getByRole('button', { name: /Tonight/ }));
    expect(onSelect).toHaveBeenCalledWith(201);
  });
});
