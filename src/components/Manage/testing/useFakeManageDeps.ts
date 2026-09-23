/**
 * An in-memory `/manage` backend, for tests and for previewing the screen.
 *
 * Implements the same {@link ManageDeps} the real page wires from playhtml and
 * the API, closely enough that the screen cannot tell: renumbering goes
 * through `planArrange` like the server, publishing applies the same
 * transforms, deleting clears every channel. Nothing leaves the browser tab,
 * which is the point — the real `/manage` writes to the live service.
 */

import { useCallback, useMemo, useState } from 'react';

import type {
  ArchiveAdminApi,
  CaptureSummary,
  PublishedEntry,
  PublishTransforms,
} from '../../../collab/useArchiveAdmin';
import type { ShowcaseApi, ShowcaseEntry } from '../../../collab/useShowcase';
import type { SnapshotApi } from '../../../collab/useSnapshot';
import { DEFAULT_PAGE_KIND, type PageKind } from '../../../domain/directory';
import { applyMenu, type CustomMenu } from '../../../domain/menu';
import { shiftPageDown } from '../../../domain/pageTransform';
import { planArrange } from '../../../domain/reorder';
import { createEmptyPage, type TeletextColor, type TeletextPage } from '../../../types/teletext';
import type { ManageDeps } from '../ManageWorkspace';

type Result = { ok: true } | { ok: false; error: string };

export interface FakeSeed {
  pages: { pageNumber: number; title?: string; kind?: PageKind; screens?: number; captureIds?: number[]; menuId?: number | null }[];
  captures?: CaptureSummary[];
  menus?: CustomMenu[];
  /** Milliseconds each network-ish call takes, to show busy states. */
  latency?: number;
}

const COLORS: TeletextColor[] = ['yellow', 'cyan', 'green', 'magenta', 'white', 'red'];

/** A recognisable page: its number big in colour, and its title under it. */
export function fakePage(label: string, seed: number): TeletextPage {
  const page = createEmptyPage();
  const fg = COLORS[seed % COLORS.length];
  const write = (row: number, text: string, color: TeletextColor, bg: TeletextColor = 'black') => {
    for (let i = 0; i < Math.min(40, text.length); i += 1) {
      page[row * 40 + i] = { ...page[row * 40 + i], char: text[i], fg: color, bg };
    }
  };
  write(2, ` ${label}`.padEnd(40), 'black', fg);
  for (let row = 4; row < 20; row += 2) {
    write(row, ` ${'lorem ipsum dolor sit amet consectetur'.slice(0, 20 + ((seed + row) % 18))}`, 'white');
  }
  write(23, ' INDICE   NOTICIAS  DESPORTO  TEMPO', 'green');
  return page;
}

export function fakeCapture(id: number, originalPage: number, title: string, topic = 'noticias'): CaptureSummary {
  return {
    id,
    source: id % 3 === 0 ? 'sic' : 'rtp',
    original_page: originalPage,
    sub: '',
    sub_index: 1,
    topic,
    topic_group: topic,
    topic_source: 'folder',
    scheme: '2001-2005',
    first_seen: '2003-05-10',
    last_seen: '2003-06-02',
    capture_count: 3,
    tier: null,
    bucket: null,
    manifest_title: title,
    decode_status: 'ok',
    profile: null,
    width: 480,
    height: 360,
    snapped_pixels: 0,
    unknown_glyphs: 0,
    corpus_file: `${originalPage}.png`,
    has_image: false,
  };
}

interface State {
  /** key `page` or `page.screen` → cells */
  cells: Map<string, TeletextPage>;
  titles: Map<number, string>;
  descriptions: Map<number, string>;
  kinds: Map<number, PageKind>;
  counts: Map<number, number>;
  published: PublishedEntry[];
  menus: CustomMenu[];
  showcase: ShowcaseEntry[];
}

const key = (page: number, screen = 1) => (screen === 1 ? String(page) : `${page}.${screen}`);

function initialState(seed: FakeSeed): State {
  const state: State = {
    cells: new Map(),
    titles: new Map(),
    descriptions: new Map(),
    kinds: new Map(),
    counts: new Map(),
    published: [],
    menus: seed.menus ?? [],
    showcase: [],
  };
  for (const [index, spec] of seed.pages.entries()) {
    const screens = spec.screens ?? 1;
    for (let screen = 1; screen <= screens; screen += 1) {
      state.cells.set(key(spec.pageNumber, screen), fakePage(`${spec.pageNumber} ${spec.title ?? ''}`.trim(), index + screen));
      const captureId = spec.captureIds?.[screen - 1];
      if (captureId != null) {
        const menu = state.menus.find((m) => m.id === spec.menuId);
        state.published.push({
          page_number: spec.pageNumber,
          subpage: screen,
          capture_id: captureId,
          title: spec.title ?? '',
          description: '',
          published_at: '2024-01-01T00:00:00Z',
          source: 'rtp',
          original_page: spec.pageNumber,
          sub: '',
          topic: 'noticias',
          scheme: '2001-2005',
          first_seen: '2003-05-10',
          manifest_title: spec.title ?? null,
          shift_down: true,
          menu_id: menu?.id ?? null,
          menu_name: menu?.name ?? null,
        });
      }
    }
    state.counts.set(spec.pageNumber, screens);
    if (spec.title) state.titles.set(spec.pageNumber, spec.title);
    if (spec.kind) state.kinds.set(spec.pageNumber, spec.kind);
  }
  return state;
}

export function useFakeManageDeps(seed: FakeSeed): ManageDeps & { captures: CaptureSummary[] } {
  const [state, setState] = useState<State>(() => initialState(seed));
  const latency = seed.latency ?? 0;
  const wait = useCallback(
    () => (latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve()),
    [latency],
  );
  const allCaptures = useMemo(() => seed.captures ?? [], [seed.captures]);

  const occupiedPages = useMemo(() => {
    const pages = new Set<number>();
    for (const [k] of state.cells) pages.add(Number(k.split('.')[0]));
    for (const [page, kind] of state.kinds) if (kind !== 'page') pages.add(page);
    return [...pages].sort((a, b) => a - b);
  }, [state]);

  const countOf = useCallback((page: number) => state.counts.get(page) ?? 1, [state.counts]);

  const livePage = useCallback(
    (page: number, screen = 1) => state.cells.get(key(page, screen)) ?? null,
    [state.cells],
  );

  const menusById = useMemo(() => new Map(state.menus.map((menu) => [menu.id, menu])), [state.menus]);
  const transform = useCallback(
    (page: TeletextPage, { shiftDown, menuId }: PublishTransforms) => {
      let result = shiftDown ? shiftPageDown(page) : page;
      const menu = menuId == null ? undefined : menusById.get(menuId);
      if (menu != null) result = applyMenu(result, menu);
      return result;
    },
    [menusById],
  );

  const clearPage = (draft: State, page: number) => {
    const count = draft.counts.get(page) ?? 1;
    for (let screen = 1; screen <= count; screen += 1) draft.cells.delete(key(page, screen));
    draft.titles.delete(page);
    draft.descriptions.delete(page);
    draft.kinds.delete(page);
    draft.counts.delete(page);
    draft.published = draft.published.filter((entry) => entry.page_number !== page);
  };

  const clone = (s: State): State => ({
    cells: new Map(s.cells),
    titles: new Map(s.titles),
    descriptions: new Map(s.descriptions),
    kinds: new Map(s.kinds),
    counts: new Map(s.counts),
    published: [...s.published],
    menus: [...s.menus],
    showcase: [...s.showcase],
  });

  const publish = useCallback<ArchiveAdminApi['publish']>(
    async ({ pageNumber, subpage = 1, captureId, title, description, transforms }) => {
      await wait();
      const capture = allCaptures.find((c) => c.id === captureId);
      const menu = transforms.menuId == null ? null : state.menus.find((m) => m.id === transforms.menuId);
      setState((current) => {
        const draft = clone(current);
        const base = fakePage(`${pageNumber} ${capture?.manifest_title ?? title}`, captureId);
        draft.cells.set(key(pageNumber, subpage), transform(base, transforms));
        draft.counts.set(pageNumber, Math.max(draft.counts.get(pageNumber) ?? 1, subpage));
        draft.titles.set(pageNumber, title);
        draft.descriptions.set(pageNumber, description);
        draft.published = draft.published.filter(
          (entry) => !(entry.page_number === pageNumber && (entry.subpage ?? 1) === subpage),
        );
        draft.published.push({
          page_number: pageNumber,
          subpage,
          capture_id: captureId,
          title,
          description,
          published_at: new Date().toISOString(),
          source: capture?.source ?? 'rtp',
          original_page: capture?.original_page ?? pageNumber,
          sub: capture?.sub ?? '',
          topic: capture?.topic ?? null,
          scheme: capture?.scheme ?? null,
          first_seen: capture?.first_seen ?? null,
          manifest_title: capture?.manifest_title ?? null,
          shift_down: transforms.shiftDown,
          menu_id: menu?.id ?? null,
          menu_name: menu?.name ?? null,
        });
        draft.published.sort((a, b) => a.page_number - b.page_number || (a.subpage ?? 1) - (b.subpage ?? 1));
        return draft;
      });
      return { ok: true };
    },
    [wait, allCaptures, state.menus, transform],
  );

  const arrange = useCallback<ArchiveAdminApi['arrange']>(
    async (moves) => {
      await wait();
      const plan = planArrange(occupiedPages, moves);
      if (!plan.ok) return { ok: false, error: `Refused: ${plan.reason}` };
      setState((current) => {
        const draft = clone(current);
        const lifted = plan.lifts.map((page) => {
          const count = current.counts.get(page) ?? 1;
          return {
            page,
            count,
            cells: Array.from({ length: count }, (_, i) => current.cells.get(key(page, i + 1))),
            title: current.titles.get(page),
            description: current.descriptions.get(page),
            kind: current.kinds.get(page),
            records: current.published.filter((entry) => entry.page_number === page),
          };
        });
        for (const item of lifted) clearPage(draft, item.page);
        for (const { from, to } of plan.drops) {
          const item = lifted.find((l) => l.page === from);
          if (item == null) continue;
          item.cells.forEach((cells, i) => cells && draft.cells.set(key(to, i + 1), cells));
          draft.counts.set(to, item.count);
          if (item.title != null) draft.titles.set(to, item.title);
          if (item.description != null) draft.descriptions.set(to, item.description);
          if (item.kind != null) draft.kinds.set(to, item.kind);
          draft.published.push(...item.records.map((entry) => ({ ...entry, page_number: to })));
        }
        draft.published.sort((a, b) => a.page_number - b.page_number || (a.subpage ?? 1) - (b.subpage ?? 1));
        return draft;
      });
      return { ok: true };
    },
    [wait, occupiedPages],
  );

  const deletePage = useCallback<ArchiveAdminApi['deletePage']>(
    async (page) => {
      await wait();
      setState((current) => {
        const draft = clone(current);
        clearPage(draft, page);
        return draft;
      });
      return { ok: true };
    },
    [wait],
  );

  const absorbPage = useCallback<ArchiveAdminApi['absorbPage']>(
    async (target, source) => {
      await wait();
      setState((current) => {
        const draft = clone(current);
        const from = current.counts.get(target) ?? 1;
        const moving = current.counts.get(source) ?? 1;
        for (let i = 1; i <= moving; i += 1) {
          const cells = current.cells.get(key(source, i));
          if (cells) draft.cells.set(key(target, from + i), cells);
          for (const entry of current.published.filter((e) => e.page_number === source && (e.subpage ?? 1) === i)) {
            draft.published.push({ ...entry, page_number: target, subpage: from + i });
          }
        }
        draft.counts.set(target, from + moving);
        clearPage(draft, source);
        return draft;
      });
      return { ok: true };
    },
    [wait],
  );

  const data: ArchiveAdminApi = {
    captures: allCaptures,
    total: allCaptures.length,
    published: state.published,
    publishedByPage: new Map(
      [...state.published].reverse().map((entry) => [entry.page_number, entry] as const),
    ),
    publicationAt: (page, screen) =>
      state.published.find((e) => e.page_number === page && (e.subpage ?? 1) === screen) ?? null,
    subpageCountOfPage: countOf,
    addSubpage: (page) => {
      const next = countOf(page) + 1;
      setState((current) => {
        const draft = clone(current);
        draft.counts.set(page, next);
        return draft;
      });
      return next;
    },
    removeLastSubpage: async (page) => {
      const count = countOf(page);
      if (count <= 1) return null;
      setState((current) => {
        const draft = clone(current);
        draft.cells.delete(key(page, count));
        draft.counts.set(page, count - 1);
        draft.published = draft.published.filter((e) => !(e.page_number === page && (e.subpage ?? 1) === count));
        return draft;
      });
      return count - 1;
    },
    absorbPage,
    menus: state.menus,
    loading: false,
    error: null,
    publishedError: null,
    pageSize: 60,
    retryCaptures: () => undefined,
    reloadPublished: () => undefined,
    loadPage: async (id) => fakePage(allCaptures.find((c) => c.id === id)?.manifest_title ?? `Capture ${id}`, id),
    livePage,
    transform,
    publish,
    unpublish: async (page) => deletePage(page),
    saveMenu: async (draft): Promise<Result> => {
      await wait();
      if (draft.name.trim() === '') return { ok: false, error: 'Give the bar a name.' };
      setState((current) => {
        const next = clone(current);
        const id = draft.id ?? Math.max(0, ...current.menus.map((m) => m.id)) + 1;
        const menu = { id, name: draft.name.trim(), items: draft.items };
        next.menus = [...current.menus.filter((m) => m.id !== id), menu].sort((a, b) => a.id - b.id);
        return next;
      });
      return { ok: true };
    },
    deleteMenu: async (id) => {
      setState((current) => {
        const next = clone(current);
        next.menus = current.menus.filter((m) => m.id !== id);
        next.published = current.published.map((e) => (e.menu_id === id ? { ...e, menu_id: null, menu_name: null } : e));
        return next;
      });
      return { ok: true };
    },
    shiftPages: async () => ({ ok: false, error: 'Not in the fake.' }),
    moveBlock: async () => ({ ok: false, error: 'Not in the fake.' }),
    arrange,
    deletePage,
    titleOf: (page) => state.titles.get(page) ?? '',
    descriptionOf: (page) => state.descriptions.get(page) ?? '',
    savePageText: (page, title, description) => {
      if (title.length > 60) return { ok: false, field: 'title', limit: 60 };
      setState((current) => {
        const draft = clone(current);
        draft.titles.set(page, title);
        draft.descriptions.set(page, description);
        return draft;
      });
      return { ok: true };
    },
    occupiedPages,
    handMadePages: occupiedPages.filter((page) => !state.published.some((e) => e.page_number === page)),
  };

  const showcase: ShowcaseApi = {
    entries: state.showcase,
    loading: false,
    error: null,
    reload: () => undefined,
    has: (page, screen) => state.showcase.some((e) => e.page_number === page && e.subpage === screen),
    add: async (page, screen = 1, position = state.showcase.length) => {
      await wait();
      setState((current) => {
        const draft = clone(current);
        draft.showcase = [
          ...current.showcase.filter((e) => !(e.page_number === page && e.subpage === screen)),
          { page_number: page, subpage: screen, position, title: current.titles.get(page) ?? '', updated_at: new Date().toISOString() },
        ].sort((a, b) => a.position - b.position);
        return draft;
      });
      return { ok: true };
    },
    remove: async (page, screen = 1) => {
      setState((current) => {
        const draft = clone(current);
        draft.showcase = current.showcase.filter((e) => !(e.page_number === page && e.subpage === screen));
        return draft;
      });
      return { ok: true };
    },
  };

  const snapshot: SnapshotApi = {
    snapshot: async () => null,
    saving: false,
    error: null,
    lastResult: null,
    pageCount: occupiedPages.length,
    progress: null,
  };

  return {
    data,
    showcase,
    kindOf: (page) => state.kinds.get(page) ?? DEFAULT_PAGE_KIND,
    setKind: (page, kind) =>
      setState((current) => {
        const draft = clone(current);
        draft.kinds.set(page, kind);
        return draft;
      }),
    snapshot,
    connected: true,
    captures: allCaptures,
  };
}
