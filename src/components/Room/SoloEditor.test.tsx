// Feature: the editor's EN key. Verifies: on a screen with English the key is
// there, `?lang=en` (the link from /manage) opens on the English, edits go to
// the English and not the Portuguese, and the key turns back to Portuguese.
// The shared-document hooks and the grid are stand-ins: this is the wiring.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { COLS, ROWS, type Cell, type TeletextPage } from '../../types/teletext';
import { SoloEditor } from './SoloEditor';

function pageSaying(text: string): TeletextPage {
  const page = Array.from({ length: COLS * ROWS }, (): Cell => ({ char: ' ', fg: 'white', bg: 'black' }));
  [...text].forEach((char, i) => (page[2 * COLS + i].char = char));
  return page;
}

const portugueseEdit = vi.fn();
const englishEdit = vi.fn(() => true);

vi.mock('../../collab/useEditPage', () => ({
  useEditPage: () => ({ page: pageSaying('Tempo'), editCell: portugueseEdit, saveError: null }),
}));
vi.mock('./useEnglishDraft', () => ({
  useEnglishDraft: () => ({ page: pageSaying('Clima'), editCell: englishEdit, saveError: null }),
}));
vi.mock('../../collab/useIsModerator', () => ({ useIsModerator: () => true }));
vi.mock('../../collab/useConnection', () => ({ useConnection: () => ({ status: 'connected' }) }));
vi.mock('../../collab/useOccupiedPages', () => ({ useOccupiedPages: () => [104] }));
vi.mock('../../collab/useSubpages', () => ({
  useSubpages: () => ({ countOf: () => 1, addSubpage: () => null, removeLastSubpage: () => null }),
}));
vi.mock('../../collab/useGuide', () => ({
  usePageTitles: () => ({ title: () => 'Estação', setTitle: () => ({ ok: true }) }),
}));
// The grid: shows its page's third row, and edits the first cell of it.
vi.mock('../Editor/Editor', () => ({
  EDITOR_NARROW_QUERY: '(max-width: 1px)',
  Editor: ({ page, onEditCell, pageDetails }: { page: TeletextPage; onEditCell(i: number, c: Cell): void; pageDetails: React.ReactNode }) => (
    <>
      <output aria-label="grid">{page.slice(2 * COLS, 2 * COLS + 5).map((c) => c.char).join('')}</output>
      <button onClick={() => onEditCell(2 * COLS, { char: 'K', fg: 'white', bg: 'black' })}>type K</button>
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

describe('the EN key in the editor', () => {
  it('opens on the English from /manage, edits it, and turns back', () => {
    renderAt('/edit/104/1?lang=en');
    const key = screen.getByRole('button', { name: 'Editar a versão inglesa deste ecrã' });
    expect(key).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('grid').textContent).toBe('Clima');

    fireEvent.click(screen.getByText('type K'));
    expect(englishEdit).toHaveBeenCalledWith(2 * COLS, expect.objectContaining({ char: 'K' }));
    expect(portugueseEdit).not.toHaveBeenCalled();

    fireEvent.click(key);
    expect(screen.getByLabelText('grid').textContent).toBe('Tempo');
    fireEvent.click(screen.getByText('type K'));
    expect(portugueseEdit).toHaveBeenCalled();
  });

  it('opens in Portuguese without the link', () => {
    renderAt('/edit/104/1');
    expect(screen.getByRole('button', { name: 'Editar a versão inglesa deste ecrã' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('grid').textContent).toBe('Tempo');
  });
});
