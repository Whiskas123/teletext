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
      { pageNumber: 301, title: 'Europe' },
    ],
  }),
}));

vi.mock('../../collab/usePageKinds', () => ({
  usePageKinds: () => ({
    kinds: { 100: 'category', 200: 'category', 300: 'category' },
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

    expect(screen.getByRole('button', { name: 'TV Guide, 2 pages' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument();
    expect(screen.queryByText('Tomorrow')).not.toBeInTheDocument();
  });

  it('says how many pages a closed section holds', () => {
    renderDirectory();
    const tvGuide = screen.getByRole('button', { name: 'TV Guide, 2 pages' });
    // Without the count a closed heading looks like an ordinary listing that
    // happens to have a triangle on it.
    expect(tvGuide).toHaveTextContent('2');
  });

  it('opens and closes one section without touching the others', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 2 pages' }));
    expect(screen.getByText('Tonight')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    // The neighbouring section stayed shut.
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 2 pages' }));
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument();
  });

  it('keeps a heading dialable, because a section is also a page', () => {
    // 100 is the main index and a real page. Folding the toggle and the page
    // into one button would have meant losing one of them.
    renderDirectory();
    expect(
      screen.getByRole('button', { name: 'Main Index, page 100' }),
    ).toBeInTheDocument();
  });

  it('requests the page when its number is chosen', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, page 200' }));
    expect(onSelect).toHaveBeenCalledWith(200);
    expect(onClose).toHaveBeenCalled();
  });

  it('reaches a page inside a section once it is open', async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole('button', { name: 'TV Guide, 2 pages' }));
    await user.click(screen.getByRole('button', { name: /Tonight/ }));
    expect(onSelect).toHaveBeenCalledWith(201);
  });
});
