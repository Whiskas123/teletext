/**
 * The pages tab: the list of every page on air, a details pane beside it, and
 * the archive as a second pane that captures are added from.
 *
 * This component owns the *rules* — what a drop means, what a move would do,
 * what can be added where — and hands the list and the panes plain answers.
 * Every rule is asked of the pure planners in `domain/`, so what the screen
 * previews and what the server is asked to do cannot disagree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ArchiveAdminApi, CaptureSummary } from '../../collab/useArchiveAdmin';
import { previewAbsorb, describeAbsorb } from '../../domain/absorb';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';
import type { PageKind } from '../../domain/directory';
import {
  describeArrangement,
  describeCloseGap,
  describeRange,
  firstFreeRun,
  lineupGroupOf,
  lineupItems,
  planArrangement,
  planCloseGap,
  planSwap,
  type LineupGroup,
  type LineupTarget,
} from '../../domain/lineup';
import { MAX_TITLE_LENGTH } from '../../domain/publication';
import { MAX_SUBPAGE, MIN_SUBPAGE } from '../../domain/subpages';
import { blockedReason } from './captureMeta';
import { ArchivePane } from './ArchivePane';
import { Dialog, type ConfirmSpec } from './Dialog';
import { currentDrag } from './dnd';
import { Inspector } from './Inspector';
import {
  LineupTable,
  type DropSpot,
  type DropVerdict,
  type LineupSection,
} from './LineupTable';
import {
  DEFAULT_ADD_SETTINGS,
  EMPTY_FILTER,
  buildRow,
  isFiltering,
  matchesFilter,
  recordsByPage,
  type AddDestination,
  type AddSettings,
  type LineupFilter,
  type PageRow,
} from './lineupModel';
import { SelectionInspector } from './SelectionInspector';
import type { ManageActionsApi } from './useManageActions';
import type { ArchiveQuery } from './useArchiveQuery';
import { useLineupSelection } from './useLineupSelection';

export interface PagesTabProps {
  data: ArchiveAdminApi;
  actions: ManageActionsApi;
  kindOf(pageNumber: number): PageKind;
  isShowcased(pageNumber: number, subpage: number): boolean;
  query: ArchiveQuery;
  /** Whether the live document has synced; until then the list is unknown. */
  connected: boolean;
  confirm(spec: ConfirmSpec): void;
}

const SECTION_COPY: Record<LineupGroup, { label: string; hint: string }> = {
  curated: { label: 'Curated · 100–699', hint: 'Only moderators edit these' },
  playground: { label: 'Playground · 700–999', hint: 'Open to every visitor' },
};

const ok = (text: string): DropVerdict => ({ ok: true, text });
const no = (text: string): DropVerdict => ({ ok: false, text });

export function PagesTab({
  data,
  actions,
  kindOf,
  isShowcased,
  query,
  connected,
  confirm,
}: PagesTabProps) {
  const selection = useLineupSelection();
  const [filter, setFilter] = useState<LineupFilter>(EMPTY_FILTER);
  const [picked, setPicked] = useState<CaptureSummary[]>([]);
  const [destination, setDestination] = useState<AddDestination>({ mode: 'pages', at: '' });
  const [settings, setSettings] = useState<AddSettings>(DEFAULT_ADD_SETTINGS);
  const [moving, setMoving] = useState<number[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const locked = actions.structuralBusy;
  const occupied = data.occupiedPages;
  const occupiedSet = useMemo(() => new Set(occupied), [occupied]);
  const published = useMemo(() => new Set(data.publishedByPage.keys()), [data.publishedByPage]);
  const records = useMemo(() => recordsByPage(data.published), [data.published]);

  const rows = useMemo(() => {
    const map = new Map<number, PageRow>();
    for (const pageNumber of occupied) {
      map.set(
        pageNumber,
        buildRow(pageNumber, records.get(pageNumber) ?? [], {
          titleOf: data.titleOf,
          descriptionOf: data.descriptionOf,
          kindOf,
          subpageCountOfPage: data.subpageCountOfPage,
          isShowcased,
          hasContent: (page) => {
            const count = data.subpageCountOfPage(page);
            for (let screen = 1; screen <= count; screen += 1) {
              if (data.livePage(page, screen) != null) return true;
            }
            return false;
          },
        }),
      );
    }
    return map;
  }, [occupied, records, data, kindOf, isShowcased]);

  const rowOf = (pageNumber: number): PageRow =>
    rows.get(pageNumber) ??
    buildRow(pageNumber, [], {
      titleOf: () => '',
      descriptionOf: () => '',
      kindOf: () => 'page',
      subpageCountOfPage: () => 1,
      isShowcased: () => false,
      hasContent: () => false,
    });

  const filtering = isFiltering(filter);
  const untitledCount = useMemo(
    () => [...rows.values()].filter((row) => row.title.trim() === '').length,
    [rows],
  );
  const sections = useMemo<LineupSection[]>(
    () =>
      (['curated', 'playground'] as const).map((group) => {
        const all = lineupItems(occupied, group);
        const items = filtering
          ? all.filter(
              (item) => item.type === 'page' && matchesFilter(rows.get(item.pageNumber)!, filter),
            )
          : all;
        return {
          group,
          ...SECTION_COPY[group],
          items,
          pageCount: items.filter((item) => item.type === 'page').length,
        };
      }),
    [occupied, filtering, filter, rows],
  );

  const order = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.flatMap((item) => (item.type === 'page' ? [item.pageNumber] : [])),
      ),
    [sections],
  );

  // Selection is read through what exists: a page deleted elsewhere drops out
  // of it without a state update of its own.
  const selectedPages = [...selection.selected]
    .filter((page) => occupiedSet.has(page))
    .sort((a, b) => a - b);
  const active =
    selection.active != null && occupiedSet.has(selection.active) ? selection.active : null;

  /* --- keyboard shortcuts outside the list ------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, select');
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* --- captures the drag or the form refers to --------------------------- */

  const captureById = useMemo(() => {
    const map = new Map<number, CaptureSummary>();
    for (const capture of data.captures) map.set(capture.id, capture);
    for (const capture of picked) map.set(capture.id, capture);
    return map;
  }, [data.captures, picked]);

  const incomingOf = (captures: readonly CaptureSummary[]) =>
    captures.map((capture) => ({
      id: capture.id,
      title: capture.manifest_title?.slice(0, MAX_TITLE_LENGTH) ?? '',
    }));

  const transforms = { shiftDown: settings.shiftDown, menuId: settings.menuId };

  const unpick = (captures: readonly CaptureSummary[]) => {
    const gone = new Set(captures.map((capture) => capture.id));
    setPicked((current) => current.filter((capture) => !gone.has(capture.id)));
  };

  /* --- the rules --------------------------------------------------------- */

  const arrangePlan = (movingPages: readonly number[], target: LineupTarget, incoming = 0) =>
    planArrangement({ occupied, published, moving: movingPages, incoming, target });

  const checkBlocked = (captures: readonly CaptureSummary[]): DropVerdict | null => {
    const blocked = captures.filter((capture) => blockedReason(capture) != null);
    return blocked.length === 0
      ? null
      : no(`${blocked.length} of these cannot be decoded, so ${blocked.length === 1 ? 'it' : 'they'} would publish blank.`);
  };

  const checkScreens = (pageNumber: number, count: number): DropVerdict => {
    if (!occupiedSet.has(pageNumber)) return no(`Page ${pageNumber} is empty — add these as new pages instead.`);
    if (pageNumber >= PLAYGROUND_MIN_PAGE) return no('Archive captures only go on pages 100–699.');
    const have = data.subpageCountOfPage(pageNumber);
    if (have + count > MAX_SUBPAGE) return no(`A page holds at most ${MAX_SUBPAGE} screens; ${pageNumber} has ${have}.`);
    const first = have + 1;
    const last = have + count;
    return ok(
      `Adds ${count === 1 ? `screen ${first}` : `screens ${first}–${last}`} to page ${pageNumber}.`,
    );
  };

  const checkMerge = (target: number, sources: readonly number[]): DropVerdict => {
    if (sources.length === 0) return no('Drop it onto a different page.');
    let total = data.subpageCountOfPage(target);
    for (const source of sources) {
      const preview = previewAbsorb({
        target,
        source,
        targetCount: total,
        sourceCount: data.subpageCountOfPage(source),
        occupied: occupiedSet,
      });
      if (!preview.ok) return no(describeAbsorb(preview));
      total += preview.moving;
    }
    if (target >= PLAYGROUND_MIN_PAGE && sources.some((source) => published.has(source))) {
      return no('Archive pages cannot become screens of a playground page.');
    }
    return ok(
      sources.length === 1
        ? describeAbsorb(
            previewAbsorb({
              target,
              source: sources[0],
              targetCount: data.subpageCountOfPage(target),
              sourceCount: data.subpageCountOfPage(sources[0]),
              occupied: occupiedSet,
            }),
          )
        : `Pages ${describeRange(sources)} become screens of page ${target}, and their numbers are freed.`,
    );
  };

  const targetOf = (spot: DropSpot): LineupTarget =>
    spot.kind === 'gap'
      ? { kind: 'at', pageNumber: spot.from }
      : { kind: spot.kind === 'into' ? 'after' : spot.kind, pageNumber: spot.pageNumber };

  const judgeDrop = (spot: DropSpot): DropVerdict => {
    const drag = currentDrag();
    if (drag == null) return no('Nothing is being dragged.');

    if (drag.kind === 'pages') {
      if (spot.kind === 'into') {
        return checkMerge(spot.pageNumber, drag.pages.filter((page) => page !== spot.pageNumber));
      }
      const plan = arrangePlan(drag.pages, targetOf(spot));
      if (plan.ok && plan.moves.length === 0) return no('It is already there.');
      return { ok: plan.ok, text: describeArrangement(plan, drag.pages) };
    }

    const captures = drag.ids.flatMap((id) => captureById.get(id) ?? []);
    const blocked = checkBlocked(captures);
    if (blocked != null) return blocked;
    if (spot.kind === 'into') return checkScreens(spot.pageNumber, captures.length);
    const plan = arrangePlan([], targetOf(spot), captures.length);
    return { ok: plan.ok, text: describeArrangement(plan, [], captures.length) };
  };

  const runArrange = async (plan: ReturnType<typeof arrangePlan>, summary: string) => {
    if (!plan.ok) return;
    if (await actions.arrange(plan.moves, summary)) selection.remap(plan.moves);
  };

  const addAsPages = async (captures: readonly CaptureSummary[], target: LineupTarget) => {
    const plan = arrangePlan([], target, captures.length);
    if (!plan.ok) return false;
    const done = await actions.addCaptures({
      mode: 'pages',
      captures: incomingOf(captures),
      moves: plan.moves,
      placed: plan.placed,
      transforms,
      kind: settings.kind,
    });
    if (done) {
      selection.selectOnly(plan.placed[0]);
      if (plan.placed.length > 1) selection.selectAll(plan.placed);
      unpick(captures);
    }
    return done;
  };

  const addAsScreens = async (captures: readonly CaptureSummary[], pageNumber: number) => {
    const first = data.subpageCountOfPage(pageNumber) + 1;
    const done = await actions.addCaptures({
      mode: 'screens',
      captures: incomingOf(captures),
      pageNumber,
      firstSubpage: first,
      transforms,
    });
    if (done) {
      selection.selectOnly(pageNumber);
      selection.setScreen(first);
      unpick(captures);
    }
  };

  const askMerge = (target: number, sources: readonly number[]) => {
    const verdict = checkMerge(target, sources);
    if (!verdict.ok) return;
    confirm({
      title: `Merge into page ${target}?`,
      body: <p>{verdict.text} Titles and roles of the merged pages are cleared.</p>,
      confirmLabel: 'Merge',
      onConfirm: async () => {
        if (await actions.mergePages(target, sources)) selection.selectOnly(target);
      },
    });
  };

  const onDrop = (spot: DropSpot) => {
    const drag = currentDrag();
    if (drag == null) return;
    if (drag.kind === 'pages') {
      if (spot.kind === 'into') {
        askMerge(spot.pageNumber, drag.pages.filter((page) => page !== spot.pageNumber));
        return;
      }
      const plan = arrangePlan(drag.pages, targetOf(spot));
      void runArrange(plan, describeArrangement(plan, drag.pages));
      return;
    }
    const captures = drag.ids.flatMap((id) => captureById.get(id) ?? []);
    if (spot.kind === 'into') void addAsScreens(captures, spot.pageNumber);
    else void addAsPages(captures, targetOf(spot));
  };

  const swap = (pageNumber: number, direction: -1 | 1) => {
    const next = pageNumber + direction;
    if (lineupGroupOf(next) !== lineupGroupOf(pageNumber) || next < 100 || next > 999) return;
    // One number at a time: into a free number if there is one, otherwise
    // trading places with the page that is there.
    const plan = occupiedSet.has(next)
      ? planSwap(pageNumber, next, published)
      : arrangePlan([pageNumber], { kind: 'at', pageNumber: next });
    if (!plan.ok) {
      actions.setNotice({ tone: 'alert', text: plan.reason });
      return;
    }
    void runArrange(
      plan,
      occupiedSet.has(next)
        ? `Pages ${pageNumber} and ${next} swapped.`
        : `Page ${pageNumber} is now ${next}.`,
    );
  };

  /**
   * Close a stretch of free numbers. Asked first: it can renumber every page to
   * the end of the range, and a renumbering has no undo here.
   */
  const askCloseGap = (gap: { from: number; to: number }) => {
    const plan = planCloseGap(occupied, gap);
    if (!plan.ok) {
      actions.setNotice({ tone: 'alert', text: plan.reason });
      return;
    }
    const size = gap.to - gap.from + 1;
    const summary = describeCloseGap(plan);
    confirm({
      title: size === 1 ? `Close the gap at ${gap.from}?` : `Close the gap at ${gap.from}–${gap.to}?`,
      confirmLabel: `Move ${plan.moves.length === 1 ? 'page' : `${plan.moves.length} pages`} up`,
      body: (
        <p>
          {summary} Their content, screens, titles and roles go with them. Gaps further down keep
          their size.
        </p>
      ),
      onConfirm: () => void runArrange(plan, `Gap closed. ${summary}`),
    });
  };

  const askDelete = (pages: readonly number[]) => {
    const titled = pages.map((page) => ({ page, title: rowOf(page).title }));
    confirm({
      title: pages.length === 1 ? `Delete page ${pages[0]}?` : `Delete ${pages.length} pages?`,
      danger: true,
      confirmLabel: pages.length === 1 ? 'Delete page' : `Delete ${pages.length} pages`,
      body: (
        <>
          <p>
            Their content, every screen, titles, descriptions and directory roles go, and archive records are
            removed. This cannot be undone here — only from a backup.
          </p>
          <ul className="mg-confirm-list">
            {titled.slice(0, 8).map(({ page, title }) => (
              <li key={page}>
                <strong>{page}</strong> {title || <em className="mg-muted">Untitled</em>}
              </li>
            ))}
            {titled.length > 8 && <li className="mg-muted">and {titled.length - 8} more</li>}
          </ul>
        </>
      ),
      onConfirm: async () => {
        if (await actions.deletePages(pages)) selection.clear();
      },
    });
  };

  /* --- the archive pane ---------------------------------------------------- */

  /**
   * Where new pages go when nobody said: straight after the selected page, or
   * after the last curated page — the end of the list, which is where "add"
   * means in every list.
   */
  const defaultAt = () => {
    if (active != null && active < PLAYGROUND_MIN_PAGE - 1) return String(active + 1);
    const last = occupied.filter((page) => page < PLAYGROUND_MIN_PAGE).at(-1);
    const next = last == null ? 100 : last + 1;
    return String(next < PLAYGROUND_MIN_PAGE ? next : (firstFreeRun(occupied, 'curated', 1) ?? ''));
  };

  const openArchive = (next: AddDestination) => {
    setDestination(next.mode === 'pages' && next.at === '' ? { mode: 'pages', at: defaultAt() } : next);
    query.setOpen(true);
  };

  const checkAdd = (): DropVerdict => {
    const blocked = checkBlocked(picked);
    if (blocked != null) return blocked;
    if (destination.mode === 'pages') {
      if (destination.at === '') return no('Say which number the first page goes on.');
      const plan = arrangePlan([], { kind: 'at', pageNumber: Number(destination.at) }, picked.length);
      return { ok: plan.ok, text: describeArrangement(plan, [], picked.length) };
    }
    if (destination.mode === 'story') {
      if (destination.at === '') return no('Say which number the page goes on.');
      if (picked.length > MAX_SUBPAGE) return no(`A page holds at most ${MAX_SUBPAGE} screens.`);
      const plan = arrangePlan([], { kind: 'at', pageNumber: Number(destination.at) }, 1);
      if (!plan.ok) return no(plan.reason);
      const pushed = describeArrangement(plan, [], 1).replace(/^Adds a page at \d+\. /, '');
      return ok(`Adds page ${plan.placed[0]} with ${picked.length} screens, in the order picked. ${pushed}`);
    }
    const pageNumber = Number(destination.page);
    if (destination.page === '') return no('Say which page.');
    if (destination.mode === 'screens') return checkScreens(pageNumber, picked.length);
    const screen = Number(destination.screen);
    const count = data.subpageCountOfPage(pageNumber);
    if (!occupiedSet.has(pageNumber)) return no(`Page ${pageNumber} is empty — add it as a new page instead.`);
    if (pageNumber >= PLAYGROUND_MIN_PAGE) return no('Archive captures only go on pages 100–699.');
    if (!Number.isInteger(screen) || screen < MIN_SUBPAGE || screen > count) {
      return no(`Page ${pageNumber} has ${count === 1 ? 'one screen' : `screens 1–${count}`}.`);
    }
    return ok(`Replaces screen ${screen} of page ${pageNumber}. Its title stays.`);
  };

  const onAdd = async () => {
    if (!checkAdd().ok) return;
    if (destination.mode === 'pages') {
      const at = Number(destination.at);
      const count = picked.length;
      if (await addAsPages(picked, { kind: 'at', pageNumber: at })) {
        // Ready for the next batch, straight after this one.
        setDestination({ mode: 'pages', at: String(at + count) });
      }
    } else if (destination.mode === 'story') {
      const plan = arrangePlan([], { kind: 'at', pageNumber: Number(destination.at) }, 1);
      if (!plan.ok) return;
      const pageNumber = plan.placed[0];
      const done = await actions.addCaptures({
        mode: 'story',
        captures: incomingOf(picked),
        moves: plan.moves,
        pageNumber,
        transforms,
        kind: settings.kind,
      });
      if (done) {
        selection.selectOnly(pageNumber);
        unpick(picked);
        setDestination({ mode: 'pages', at: String(pageNumber + 1) });
      }
    } else if (destination.mode === 'screens') {
      await addAsScreens(picked, Number(destination.page));
    } else {
      const pageNumber = Number(destination.page);
      const screen = Number(destination.screen);
      const done = await actions.addCaptures({
        mode: 'replace',
        capture: incomingOf(picked)[0],
        pageNumber,
        subpage: screen,
        transforms,
      });
      if (done) {
        selection.selectOnly(pageNumber);
        selection.setScreen(screen);
        setPicked([]);
      }
    }
  };

  /**
   * Pick every screen of a capture's story, in screen order, after whatever is
   * already picked — and switch to adding them as one page, since that is what
   * a whole story is for.
   */
  const pickStory = async (capture: CaptureSummary) => {
    const story = await data.loadStory(capture.id);
    if (story.length === 0) return;
    setPicked((current) => {
      const have = new Set(current.map((c) => c.id));
      return [...current, ...story.filter((c) => !have.has(c.id))];
    });
    if (destination.mode === 'pages') setDestination({ mode: 'story', at: destination.at });
  };

  /* --- the details pane ---------------------------------------------------- */

  const selectedRows = selectedPages.map(rowOf);

  let side: React.ReactNode;
  if (query.open) {
    side = (
      <ArchivePane
        query={query}
        captures={data.captures}
        total={data.total}
        pageSize={data.pageSize}
        loading={data.loading}
        error={data.error}
        onRetry={data.retryCaptures}
        picked={picked}
        setPicked={setPicked}
        destination={destination}
        setDestination={setDestination}
        settings={settings}
        setSettings={setSettings}
        menus={data.menus}
        checkAdd={checkAdd}
        onAdd={() => void onAdd()}
        onPickStory={(capture) => void pickStory(capture)}
        loadPage={data.loadPage}
        transform={data.transform}
        locked={locked}
        onClose={() => query.setOpen(false)}
      />
    );
  } else if (selectedRows.length > 1) {
    side = (
      <SelectionInspector
        rows={selectedRows}
        menus={data.menus}
        locked={locked}
        onSetRole={(kind) => actions.setRole(selectedPages, kind)}
        onSetBar={(menuId) => void actions.applyTransforms(selectedPages, { shiftDown: null, menuId })}
        onSetShift={(shiftDown) =>
          void actions.applyTransforms(selectedPages, { shiftDown, menuId: 'keep' })
        }
        onMove={() => setMoving(selectedPages)}
        onFillTitles={() => actions.fillTitles(selectedPages)}
        onMerge={() => askMerge(selectedPages[0], selectedPages.slice(1))}
        onDelete={() => askDelete(selectedPages)}
        onClear={selection.clear}
      />
    );
  } else if (active != null) {
    const row = rowOf(active);
    side = (
      <Inspector
        key={active}
        row={row}
        screen={selection.screen}
        setScreen={selection.setScreen}
        records={records.get(active) ?? []}
        livePage={data.livePage}
        menus={data.menus}
        busy={actions.inFlight.pageBusy(active)}
        locked={locked}
        isShowcased={isShowcased}
        titleRef={titleRef}
        checkMove={(target) => {
          if (target === active) return no(`Page ${active} is already there.`);
          const plan = arrangePlan([active], { kind: 'at', pageNumber: target });
          return { ok: plan.ok, text: describeArrangement(plan, [active]) };
        }}
        onMove={(target) => {
          const plan = arrangePlan([active], { kind: 'at', pageNumber: target });
          void runArrange(plan, describeArrangement(plan, [active]));
        }}
        checkFold={(source) => checkMerge(active, [source])}
        onFold={(source) => {
          void actions.mergePages(active, [source]);
        }}
        onSaveText={(title, description) => void actions.saveText(active, title, description)}
        onSetRole={(kind) => actions.setRole([active], kind)}
        onSetBar={(menuId) => void actions.applyTransforms([active], { shiftDown: null, menuId })}
        onSetShift={(shiftDown) => void actions.applyTransforms([active], { shiftDown, menuId: 'keep' })}
        onAddEmptyScreen={() => {
          actions.addSubpage(active);
          selection.setScreen(row.screens + 1);
        }}
        onRemoveLastScreen={() =>
          confirm({
            title: `Remove screen ${row.screens} of page ${active}?`,
            danger: true,
            confirmLabel: 'Remove screen',
            body: <p>Its content goes, and its archive record if it has one. Screens are numbered by position, so only the last can be removed.</p>,
            onConfirm: () => {
              actions.removeLastSubpage(active);
              selection.setScreen(Math.max(1, row.screens - 1));
            },
          })
        }
        onAddScreensFromArchive={() => openArchive({ mode: 'screens', page: String(active) })}
        onReplaceScreen={(screen) =>
          openArchive({ mode: 'replace', page: String(active), screen: String(screen) })
        }
        onToggleShowcase={(screen, on) => actions.toggleShowcase(active, screen, on)}
        onDelete={() => askDelete([active])}
        onClose={selection.clear}
      />
    );
  } else {
    side = <Overview rows={rows} occupied={occupied} onAdd={() => openArchive({ mode: 'pages', at: '' })} />;
  }

  const shownCount = order.length;
  const emptyMessage = !connected
    ? 'Reading the live pages…'
    : occupied.length === 0
      ? 'No page holds anything yet. Add some from the archive.'
      : filtering && shownCount === 0
        ? 'No page matches the filter.'
        : null;

  return (
    <div className={`mg-pages${query.open ? ' mg-pages-archive' : ''}`}>
      <div className="mg-list">
        <div className="mg-toolbar" role="search">
          <input
            ref={searchRef}
            type="search"
            className="mg-input mg-search"
            aria-label="Filter pages"
            placeholder="Filter by number, title or source   /"
            value={filter.text}
            onChange={(event) => setFilter({ ...filter, text: event.target.value.slice(0, 64) })}
          />
          <select
            className="mg-input"
            aria-label="Source"
            value={filter.source}
            onChange={(event) => setFilter({ ...filter, source: event.target.value as LineupFilter['source'] })}
          >
            <option value="all">Any source</option>
            <option value="archive">From the archive</option>
            <option value="hand-made">Hand-made</option>
          </select>
          <select
            className="mg-input"
            aria-label="Bottom bar"
            value={filter.bar}
            onChange={(event) => setFilter({ ...filter, bar: event.target.value })}
          >
            <option value="all">Any bottom bar</option>
            <option value="own">Own row</option>
            {data.menus.map((menu) => (
              <option key={menu.id} value={String(menu.id)}>
                {menu.name}
              </option>
            ))}
          </select>
          {(untitledCount > 0 || filter.untitled) && (
            <button
              type="button"
              className={`mg-btn mg-btn-small${filter.untitled ? ' mg-btn-on' : ' mg-btn-ghost'}`}
              aria-pressed={filter.untitled}
              title="Show only pages with no title"
              onClick={() => setFilter({ ...filter, untitled: !filter.untitled })}
            >
              Untitled · {untitledCount}
            </button>
          )}
          {filtering && (
            <button type="button" className="mg-btn mg-btn-small mg-btn-ghost" onClick={() => setFilter(EMPTY_FILTER)}>
              Clear · {shownCount} of {occupied.length}
            </button>
          )}
          <span className="mg-grow" />
          <button
            type="button"
            className={`mg-btn${query.open ? ' mg-btn-on' : ' mg-btn-primary'}`}
            aria-pressed={query.open}
            onClick={() =>
              query.open ? query.setOpen(false) : openArchive({ mode: 'pages', at: '' })
            }
          >
            {query.open ? 'Close archive' : '+ Add from archive'}
          </button>
        </div>

        {data.publishedError != null && (
          <div className="mg-banner" role="alert">
            Could not load which pages came from the archive: {data.publishedError}{' '}
            <button type="button" className="mg-btn mg-btn-small" onClick={data.reloadPublished}>
              Retry
            </button>
          </div>
        )}

        <LineupTable
          sections={connected ? sections : []}
          rowOf={rowOf}
          order={order}
          selection={selection}
          livePage={data.livePage}
          publicationAt={data.publicationAt}
          pageBusy={actions.inFlight.pageBusy}
          outcomes={actions.outcomes}
          locked={locked}
          judgeDrop={judgeDrop}
          onDrop={onDrop}
          onSwap={swap}
          onDelete={askDelete}
          onRename={(page) => {
            selection.selectOnly(page);
            query.setOpen(false);
            requestAnimationFrame(() => titleRef.current?.focus());
          }}
          onAddAt={(from) => openArchive({ mode: 'pages', at: String(from) })}
          onCloseGap={askCloseGap}
          emptyMessage={emptyMessage}
        />

        {selectedPages.length > 1 && (
          <div className="mg-bulkbar" role="toolbar" aria-label="Selected pages">
            <strong>{selectedPages.length} selected</strong>
            <button type="button" className="mg-btn mg-btn-small" disabled={locked} onClick={() => setMoving(selectedPages)}>
              Move to…
            </button>
            <button
              type="button"
              className="mg-btn mg-btn-small"
              disabled={locked}
              onClick={() => askMerge(selectedPages[0], selectedPages.slice(1))}
            >
              Merge as screens
            </button>
            <button
              type="button"
              className="mg-btn mg-btn-small mg-btn-danger-ghost"
              disabled={locked}
              onClick={() => askDelete(selectedPages)}
            >
              Delete
            </button>
            <span className="mg-grow" />
            <button type="button" className="mg-btn mg-btn-small mg-btn-ghost" onClick={selection.clear}>
              Clear <kbd>Esc</kbd>
            </button>
          </div>
        )}
      </div>

      <div className="mg-side">{side}</div>

      {moving != null && (
        <MoveDialog
          pages={moving}
          check={(target) => {
            const plan = arrangePlan(moving, { kind: 'at', pageNumber: target });
            return { ok: plan.ok && plan.moves.length > 0, text: describeArrangement(plan, moving) };
          }}
          onMove={(target) => {
            const plan = arrangePlan(moving, { kind: 'at', pageNumber: target });
            void runArrange(plan, describeArrangement(plan, moving));
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

function MoveDialog({
  pages,
  check,
  onMove,
  onClose,
}: {
  pages: readonly number[];
  check(target: number): DropVerdict;
  onMove(target: number): void;
  onClose(): void;
}) {
  const [value, setValue] = useState('');
  const verdict = value.length === 3 ? check(Number(value)) : null;
  const submit = () => {
    if (!verdict?.ok) return;
    onClose();
    onMove(Number(value));
  };
  return (
    <Dialog
      title={pages.length === 1 ? `Move page ${pages[0]}` : `Move ${pages.length} pages`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="mg-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mg-btn mg-btn-primary" disabled={!verdict?.ok} onClick={submit}>
            Move
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="mg-field">
          <span className="mg-label">
            {pages.length === 1 ? 'New number' : `First number (they stay in order: ${describeRange(pages)})`}
          </span>
          <input
            className="mg-input mg-input-num"
            inputMode="numeric"
            data-autofocus
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </label>
      </form>
      <p className={`mg-note${verdict != null && !verdict.ok ? ' mg-note-bad' : ''}`} role="status">
        {verdict?.text ?? 'Whatever is already on those numbers makes way, up to the first free number.'}
      </p>
    </Dialog>
  );
}

/** What the details pane shows with nothing selected. */
function Overview({
  rows,
  occupied,
  onAdd,
}: {
  rows: ReadonlyMap<number, PageRow>;
  occupied: readonly number[];
  onAdd(): void;
}) {
  const all = [...rows.values()];
  const curated = occupied.filter((page) => page < PLAYGROUND_MIN_PAGE).length;
  const archive = all.filter((row) => row.archiveScreens > 0).length;
  const blank = all.filter((row) => !row.hasContent).length;
  const screens = all.reduce((sum, row) => sum + row.screens, 0);
  return (
    <aside className="mg-inspector mg-overview" aria-label="Overview">
      <dl className="mg-stats">
        <div>
          <dt>Curated pages</dt>
          <dd>{curated}</dd>
        </div>
        <div>
          <dt>Playground pages</dt>
          <dd>{occupied.length - curated}</dd>
        </div>
        <div>
          <dt>From the archive</dt>
          <dd>{archive}</dd>
        </div>
        <div>
          <dt>Screens in total</dt>
          <dd>{screens}</dd>
        </div>
      </dl>
      {blank > 0 && (
        <p className="mg-note mg-note-warn">
          {blank} {blank === 1 ? 'page draws' : 'pages draw'} nothing and {blank === 1 ? 'is' : 'are'} skipped by
          readers — filter the list to find them, and delete them to free the numbers.
        </p>
      )}
      <button type="button" className="mg-btn mg-btn-primary" onClick={onAdd}>
        + Add from archive
      </button>
      <h3 className="mg-h3">Shortcuts</h3>
      <dl className="mg-keys">
        <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Move through pages</dd></div>
        <div><dt><kbd>Shift</kbd> + click</dt><dd>Select a range</dd></div>
        <div><dt><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + click</dt><dd>Add to selection</dd></div>
        <div><dt><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Move a page one number</dd></div>
        <div><dt>Drag a row</dt><dd>Reorder; drop onto a page to merge</dd></div>
        <div><dt><kbd>→</kbd> <kbd>←</kbd></dt><dd>Show / hide screens</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>Edit the title</dd></div>
        <div><dt><kbd>Delete</kbd></dt><dd>Delete selected</dd></div>
        <div><dt><kbd>/</kbd></dt><dd>Filter</dd></div>
      </dl>
    </aside>
  );
}
