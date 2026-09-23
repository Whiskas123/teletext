/**
 * `/manage-preview.html` — the manage workspace on the in-memory backend.
 * Dev only; see the note in that file.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import '../index.css';
import '../App.css';
import '../styles/teletext.css';
import { ManageWorkspace } from '../components/Manage/ManageWorkspace';
import { useFakeManageDeps, fakeCapture, type FakeSeed } from '../components/Manage/testing/useFakeManageDeps';
import { useArchiveQuery } from '../components/Manage/useArchiveQuery';
import { useManageTab } from '../components/Manage/useManageTab';

const SECTIONS = ['INDICE', 'NOTICIAS', 'DESPORTO', 'TEMPO', 'TV', 'CULTURA'];

const seed: FakeSeed = {
  latency: 350,
  menus: [
    { id: 1, name: 'Main navigation', items: [
      { label: 'INDICE', pageNumber: 100 }, { label: 'NOTICIAS', pageNumber: 200 },
      { label: 'DESPORTO', pageNumber: 300 }, { label: 'TEMPO', pageNumber: 400 },
    ] },
    { id: 2, name: 'Sport', items: [
      { label: 'FUTEBOL', pageNumber: 310 }, { label: 'MODALID', pageNumber: 330 },
      { label: 'RESULT', pageNumber: 350 }, { label: 'INDICE', pageNumber: 100 },
    ] },
  ],
  pages: [
    { pageNumber: 100, title: 'Índice geral', kind: 'category', captureIds: [9001], menuId: 1 },
    ...SECTIONS.slice(1).flatMap((name, s) => {
      const base = (s + 2) * 100;
      return [
        { pageNumber: base, title: name, kind: 'category' as const, captureIds: [base * 10], menuId: 1 },
        ...Array.from({ length: 4 + (s % 3) }, (_, i) => ({
          pageNumber: base + 1 + i,
          title: `${name.toLowerCase()} story ${i + 1}`,
          captureIds: i === 1 ? [base * 10 + 1, base * 10 + 2, base * 10 + 3] : [base * 10 + i + 5],
          screens: i === 1 ? 3 : 1,
          menuId: s === 1 ? 2 : i % 2 === 0 ? 1 : null,
        })),
      ];
    }),
    { pageNumber: 118, title: 'Continued story' },
    { pageNumber: 700, title: 'Playground hello' },
    { pageNumber: 701, title: '' },
    { pageNumber: 745, title: 'Visitor art' },
  ],
  captures: [
    ...Array.from({ length: 36 }, (_, i) =>
      fakeCapture(80000 + i, 200 + (i % 40), `Arquivo ${['Lisboa', 'Porto', 'Benfica', 'Chuva', 'Bolsa', 'RTP1'][i % 6]} ${i + 1}`, ['noticias', 'desporto', 'meteorologia'][i % 3]),
    ),
    // A SIC story over four screens, untitled like all of SIC.
    ...[1, 2, 3, 4].map((sub) => ({
      ...fakeCapture(90000 + sub, 571, ''),
      source: 'sic' as const,
      sub: `000${sub}`,
      sub_index: sub,
      manifest_title: null,
    })),
  ],
};

export function Preview() {
  const tab = useManageTab();
  const query = useArchiveQuery(tab.initialArchive);
  const deps = useFakeManageDeps(seed, query.queryFilters);
  return <ManageWorkspace deps={deps} tab={tab} query={query} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={['/manage']}>
      <Preview />
    </MemoryRouter>
  </StrictMode>,
);
