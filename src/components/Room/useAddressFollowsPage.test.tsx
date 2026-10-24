// Feature: the address and tab title follow the page being watched. Verifies:
// changing page or screen replaces the address (query kept, language prefix
// kept, `/kiosk` stays `/kiosk`) without remounting the viewer, the title is
// the page's own, and leaving gives the tab the next screen's title — not the
// one from before the viewer opened, which may have been a page's.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { LanguageContext } from './languageContext';
import { useAddressFollowsPage } from './useAddressFollowsPage';

vi.mock('../../collab/useGuide', () => ({
  usePageTitles: () => ({ title: (n: number) => (n === 105 ? 'Dias nacionais' : '') }),
}));

let mounts = 0;

/** The viewer's shape: the page read from the URL once, then local state. */
function Viewer({ kiosk = false }: { kiosk?: boolean }) {
  const params = useParams();
  const [page, setPage] = useState(() => Number(params.pageNumber ?? 100));
  const [screenNo, setScreen] = useState(() => Number(params.subpage ?? 1));
  const [mount] = useState(() => (mounts += 1));
  useAddressFollowsPage(page, screenNo, kiosk);
  const location = useLocation();
  return (
    <>
      <output aria-label="where">{`${location.pathname}${location.search}`}</output>
      <output aria-label="mount">{mount}</output>
      <button onClick={() => setPage((n) => n + 1)}>next page</button>
      <button onClick={() => setScreen((n) => n + 1)}>next screen</button>
    </>
  );
}

function renderAt(url: string, language: 'pt' | 'en' = 'pt') {
  mounts = 0;
  const watch = ['watch', 'watch/:pageNumber', 'watch/:pageNumber/:subpage'];
  const kiosk = ['kiosk', 'kiosk/:pageNumber', 'kiosk/:pageNumber/:subpage'];
  const prefix = language === 'en' ? '/en/' : '/';
  return render(
    <LanguageContext value={language}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          {watch.map((path) => (
            <Route key={path} path={prefix + path} element={<Viewer />} />
          ))}
          {kiosk.map((path) => (
            <Route key={path} path={prefix + path} element={<Viewer kiosk />} />
          ))}
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </LanguageContext>,
  );
}

const where = () => screen.getByLabelText('where').textContent;

describe('the address follows the page', () => {
  it('replaces the address as the page and screen change, in one viewer', () => {
    renderAt('/watch/104?exhibit=1');
    fireEvent.click(screen.getByText('next page'));
    expect(where()).toBe('/watch/105?exhibit=1');
    expect(document.title).toBe('Dias nacionais — página 105 — Tele-textual');

    fireEvent.click(screen.getByText('next screen'));
    expect(where()).toBe('/watch/105/2?exhibit=1');
    expect(screen.getByLabelText('mount').textContent).toBe('1');
  });

  it('gives a bare /watch its page, and keeps the language and kiosk', () => {
    renderAt('/watch');
    expect(where()).toBe('/watch/100');

    renderAt('/en/watch/104', 'en');
    fireEvent.click(screen.getAllByText('next page').at(-1)!);
    expect(screen.getAllByLabelText('where').at(-1)!.textContent).toBe('/en/watch/105');
    expect(document.title).toBe('Dias nacionais — page 105 — Tele-textual');

    renderAt('/kiosk/104');
    fireEvent.click(screen.getAllByText('next page').at(-1)!);
    expect(screen.getAllByLabelText('where').at(-1)!.textContent).toBe('/kiosk/105');
  });

  it("gives the tab the next screen's title when the viewer closes", () => {
    // As if the visit started at /watch/104: the static HTML named that page.
    document.title = 'Estação do Oriente — página 104 — Tele-textual';
    window.history.replaceState(null, '', '/guestbook');
    const { unmount } = renderAt('/watch/104');
    act(() => unmount());
    expect(document.title).toBe('Guestbook — Tele-textual');
  });
});
