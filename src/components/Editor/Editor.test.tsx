// Feature: the editor's own controls — undo, redo, clear, and the eraser.
// Verifies: typed characters undo one at a time and redo again, ⌘/Ctrl+Z works
// from the grid, clearing the page asks first and is undone as one step, and
// the eraser is a switch on Draw that clears what a stroke crosses.

import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { Editor } from './Editor';
import { COLS, createEmptyPage, type Cell, type TeletextPage } from '../../types/teletext';

/** The editor over a page held in state, as `useEditPage` would hold it. */
function Harness({ onPage }: { onPage: (page: TeletextPage) => void }) {
  const [page, setPage] = useState<TeletextPage>(() => {
    const initial = createEmptyPage();
    onPage(initial);
    return initial;
  });
  return (
    <Editor
      page={page}
      pageNumber={700}
      onEditCell={(index: number, cell: Cell) => {
        setPage((prev) => {
          const next = [...prev];
          next[index] = cell;
          onPage(next);
          return next;
        });
      }}
    />
  );
}

function setup() {
  let current: TeletextPage = createEmptyPage();
  const view = render(<Harness onPage={(page) => (current = page)} />);
  const input = view.container.querySelector<HTMLInputElement>('.editor-hidden-input')!;
  const type = (char: string) => {
    act(() => {
      fireEvent.input(input, { target: { value: char } });
    });
  };
  return { page: () => current, input, type };
}

const undoKey = () => screen.getByRole('button', { name: 'Desfazer' });
const redoKey = () => screen.getByRole('button', { name: 'Refazer' });

describe('Editor history', () => {
  it('undoes typed characters one at a time, and redoes them', () => {
    const { page, type } = setup();
    expect(undoKey()).toBeDisabled();

    type('a');
    type('b');
    expect(page()[COLS].char).toBe('a');
    expect(page()[COLS + 1].char).toBe('b');

    fireEvent.click(undoKey());
    expect(page()[COLS + 1].char).toBe(' ');
    expect(page()[COLS].char).toBe('a');

    fireEvent.click(undoKey());
    expect(page()[COLS].char).toBe(' ');
    expect(undoKey()).toBeDisabled();

    fireEvent.click(redoKey());
    expect(page()[COLS].char).toBe('a');
  });

  it('undoes from the keyboard while the grid has focus', () => {
    const { page, input, type } = setup();
    type('a');

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(page()[COLS].char).toBe(' ');

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(page()[COLS].char).toBe('a');
  });

  it('asks before clearing the page, and undoes the clear as one step', () => {
    const { page, type } = setup();
    type('a');
    type('b');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar a página inteira' }));
    const question = screen.getByRole('alertdialog', { name: 'Limpar a página inteira?' });
    fireEvent.click(within(question).getByRole('button', { name: 'Limpar' }));

    expect(page()[COLS].char).toBe(' ');
    expect(page()[COLS + 1].char).toBe(' ');

    fireEvent.click(undoKey());
    expect(page()[COLS].char).toBe('a');
    expect(page()[COLS + 1].char).toBe('b');
  });
});

describe('Editor strokes', () => {
  /**
   * Lay the grid out at 10px a cell, so a pointer position names a cell. jsdom
   * has no layout, and the grid finds the cell under a pointer from its box.
   */
  function drawable(container: HTMLElement) {
    const grid = container.querySelector<HTMLElement>('.teletext-grid-drawable')!;
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 240, right: 400, bottom: 240, x: 0, y: 0 }) as DOMRect;
    /** Drag along row 1 from column `from` to column `to`. */
    return (from: number, to: number) => {
      fireEvent.pointerDown(grid, { clientX: from * 10 + 5, clientY: 15, pointerId: 1 });
      fireEvent.pointerMove(grid, { clientX: to * 10 + 5, clientY: 15, pointerId: 1 });
      fireEvent.pointerUp(grid, { clientX: to * 10 + 5, clientY: 15, pointerId: 1 });
    };
  }

  it('undoes a whole stroke in one step, and only the last stroke', () => {
    let current: TeletextPage = createEmptyPage();
    const { container } = render(<Harness onPage={(page) => (current = page)} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Desenhar' }));
    const drag = drawable(container);

    drag(0, 3);
    drag(10, 12);
    const painted = (col: number) => current[COLS + col].graphics != null;
    expect([0, 1, 2, 3, 10, 11, 12].every(painted)).toBe(true);

    fireEvent.click(undoKey());
    expect([10, 11, 12].some(painted)).toBe(false);
    expect([0, 1, 2, 3].every(painted)).toBe(true);

    fireEvent.click(undoKey());
    expect([0, 1, 2, 3].some(painted)).toBe(false);
  });
});

describe('Editor eraser', () => {
  it('is a paint / erase switch on Draw, and is put down with the tool', () => {
    setup();
    expect(screen.queryByRole('radio', { name: 'Apagar' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Desenhar' }));
    expect(screen.getByRole('radio', { name: 'Pintar' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Apagar' }));
    expect(screen.getByRole('radio', { name: 'Apagar' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Escrever' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Desenhar' }));
    expect(screen.getByRole('radio', { name: 'Pintar' })).toBeChecked();
  });

  it('clears the cells a stroke crosses when it is on', () => {
    let current: TeletextPage = createEmptyPage();
    const { container } = render(<Harness onPage={(page) => (current = page)} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Desenhar' }));
    const grid = container.querySelector<HTMLElement>('.teletext-grid-drawable')!;
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 240, right: 400, bottom: 240, x: 0, y: 0 }) as DOMRect;
    const stroke = () => {
      fireEvent.pointerDown(grid, { clientX: 5, clientY: 15, pointerId: 1 });
      fireEvent.pointerMove(grid, { clientX: 35, clientY: 15, pointerId: 1 });
      fireEvent.pointerUp(grid, { clientX: 35, clientY: 15, pointerId: 1 });
    };

    stroke();
    expect(current[COLS].graphics).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Apagar' }));
    stroke();
    expect([0, 1, 2, 3].some((col) => current[COLS + col].graphics != null)).toBe(false);
  });
});
