// Feature: frozen screens. A visitor on a frozen screen cannot draw on it and is
// told so; another screen of the same page still takes edits. Stand-ins as in
// SoloEditor.test.tsx: this is the wiring, not the grid.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPage, type Cell } from '../../types/teletext';
import { SoloEditor } from './SoloEditor';

const editCell = vi.fn();

vi.mock('../../collab/useEditPage', () => ({
  useEditPage: () => ({ page: createEmptyPage(), editCell, saveError: null }),
}));
vi.mock('./useEnglishDraft', () => ({
  useEnglishDraft: () => ({ page: null, editCell: () => false, saveError: null }),
}));
vi.mock('../../collab/useIsModerator', () => ({ useIsModerator: () => false }));
vi.mock('../../collab/useFrozenPages', () => ({
  useFrozenPages: () => ({
    isFrozen: (page: number, sub = 1) => page === 745 && sub === 1,
    hasFrozen: (page: number) => page === 745,
    setFrozen: () => {},
  }),
}));
vi.mock('../../collab/useEditPresence', () => ({
  useEditPresence: () => ({ others: [], setCursor: () => {}, name: 'Guest', color: 'red', setName: () => true }),
}));
vi.mock('../../collab/usePageReader', () => ({ usePageReader: () => () => null }));
vi.mock('../../collab/useConnection', () => ({ useConnection: () => ({ status: 'connected' }) }));
vi.mock('../../collab/useOccupiedPages', () => ({ useOccupiedPages: () => [745] }));
vi.mock('../../collab/useSubpages', () => ({
  useSubpages: () => ({ countOf: () => 2, addSubpage: () => null, removeLastSubpage: () => null }),
}));
vi.mock('../../collab/useGuide', () => ({
  usePageTitles: () => ({ title: () => 'Arte', setTitle: () => ({ ok: true }) }),
}));
vi.mock('../Editor/Editor', () => ({
  EDITOR_NARROW_QUERY: '(max-width: 1px)',
  Editor: ({
    onEditCell,
    alert,
    pageDetails,
  }: {
    onEditCell(i: number, c: Cell): void;
    alert: React.ReactNode;
    pageDetails: React.ReactNode;
  }) => (
    <>
      <button onClick={() => onEditCell(0, { char: 'K', fg: 'white', bg: 'black' })}>type K</button>
      {alert}
      {pageDetails}
    </>
  ),
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/edit/:pageNumber/:subpage" element={<SoloEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a frozen screen in the editor', () => {
  beforeEach(() => editCell.mockClear());

  it('refuses edits and says why', () => {
    renderAt('/edit/745/1');
    fireEvent.click(screen.getByText('type K'));
    expect(editCell).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('745/1');
  });

  it('leaves the page’s other screens editable', () => {
    renderAt('/edit/745/1');
    fireEvent.click(screen.getByRole('tab', { name: 'Subpágina 2' }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText('type K'));
    expect(editCell).toHaveBeenCalled();
  });

  // A link to a screen opens that screen, not screen 1 (the page-change reset
  // used to run on mount too). Here screen 1 is the frozen one.
  it('opens on the screen the link names', () => {
    renderAt('/edit/745/2');
    expect(screen.getByRole('tab', { name: 'Subpágina 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText('type K'));
    expect(editCell).toHaveBeenCalled();
  });
});
