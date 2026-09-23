/**
 * The pages, as one list in number order.
 *
 * Rows, not cards: a service is read top to bottom, and a row per page is what
 * lets several hundred of them fit on a screen and be scanned. Everything that
 * changes a page lives in the inspector beside the list; a row only says what
 * the page *is* and takes the gestures that act on its position:
 *
 * - **drag** a row (or the selection) to reorder — between two rows, or onto a
 *   stretch of free numbers; drop *onto* a row to fold it in as more screens;
 * - **Alt+↑/↓** swaps a page with the row above or below;
 * - **↑/↓** move focus, with Shift to extend the selection, **Space** toggles,
 *   **Delete** deletes, **Enter** jumps to the title, **→/←** open and close a
 *   page's screens, **Esc** clears, **Cmd/Ctrl+A** selects everything shown.
 *
 * Free numbers are rows too. They are where a new section goes, and seeing
 * "205–299 free" is the difference between knowing where to put something and
 * guessing.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import type { LineupGroup, LineupItem } from '../../domain/lineup';
import type { PageActionName } from '../../domain/inFlight';
import type { Notice } from '../../domain/manageMessages';
import type { TeletextPage } from '../../types/teletext';
import { beginDrag, currentDrag, endDrag } from './dnd';
import { describeBar, type PageRow } from './lineupModel';
import { PageThumb } from './PageThumb';
import type { LineupSelection } from './useLineupSelection';

/** Where a drag would land. */
export type DropSpot =
  | { kind: 'before' | 'after' | 'into'; pageNumber: number }
  | { kind: 'gap'; from: number; to: number };

export interface DropVerdict {
  ok: boolean;
  text: string;
}

export interface LineupSection {
  group: LineupGroup;
  label: string;
  hint: string;
  items: LineupItem[];
  pageCount: number;
}

export interface LineupTableProps {
  sections: readonly LineupSection[];
  rowOf(pageNumber: number): PageRow;
  /** Visible page numbers in list order, for ranges and arrow keys. */
  order: readonly number[];
  selection: LineupSelection;
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  publicationAt(pageNumber: number, subpage: number): PublishedEntry | null;
  pageBusy(pageNumber: number): PageActionName | null;
  outcomes: ReadonlyMap<number, Notice>;
  /** A structural action is running: nothing can be dragged or dropped. */
  locked: boolean;
  /** What dropping the current drag here would do. */
  judgeDrop(spot: DropSpot): DropVerdict;
  onDrop(spot: DropSpot): void;
  onSwap(pageNumber: number, direction: -1 | 1): void;
  onDelete(pages: readonly number[]): void;
  onRename(pageNumber: number): void;
  /** Open the archive pane aimed at this stretch of free numbers. */
  onAddAt(from: number): void;
  emptyMessage: string | null;
}

const KIND_LABEL: Record<string, string> = {
  category: 'Category',
  subcategory: 'Subcategory',
  subsubcategory: 'Sub-sub',
  page: 'Page',
};

export function LineupTable({
  sections,
  rowOf,
  order,
  selection,
  livePage,
  publicationAt,
  pageBusy,
  outcomes,
  locked,
  judgeDrop,
  onDrop,
  onSwap,
  onDelete,
  onRename,
  onAddAt,
  emptyMessage,
}: LineupTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [verdict, setVerdict] = useState<DropVerdict | null>(null);
  const [dragging, setDragging] = useState<ReadonlySet<number>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<LineupGroup>>(new Set());

  const { selected, active } = selection;

  // Keep keyboard focus on the active row — but only while focus is already in
  // the list, so selecting a row from the inspector never steals the caret.
  useEffect(() => {
    const table = tableRef.current;
    if (table == null || active == null) return;
    if (!table.contains(document.activeElement)) return;
    table.querySelector<HTMLElement>(`[data-page="${active}"]`)?.focus();
  }, [active]);

  const sameSpot = (a: DropSpot | null, b: DropSpot) =>
    a != null &&
    a.kind === b.kind &&
    (a.kind === 'gap' ? b.kind === 'gap' && a.from === b.from : 'pageNumber' in b && a.pageNumber === b.pageNumber);

  const hover = (event: DragEvent, next: DropSpot) => {
    if (locked || currentDrag() == null) return;
    event.preventDefault();
    event.stopPropagation();
    // Judged once per spot, not once per `dragover` — that fires every few
    // milliseconds while the pointer is still.
    let judged = verdict;
    if (!sameSpot(spot, next)) {
      judged = judgeDrop(next);
      setSpot(next);
      setVerdict(judged);
    }
    event.dataTransfer.dropEffect = judged?.ok
      ? currentDrag()?.kind === 'captures'
        ? 'copy'
        : 'move'
      : 'none';
  };

  const clearDrag = () => {
    setSpot(null);
    setVerdict(null);
    setDragging(new Set());
  };

  const drop = (event: DragEvent, target: DropSpot) => {
    event.preventDefault();
    event.stopPropagation();
    const ok = judgeDrop(target).ok;
    clearDrag();
    if (ok) onDrop(target);
    endDrag();
  };

  /** Top quarter: before. Bottom quarter: after. Between: into. */
  const zoneOf = (event: DragEvent<HTMLElement>, pageNumber: number): DropSpot => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
    if (y < 0.28) return { kind: 'before', pageNumber };
    if (y > 0.72) return { kind: 'after', pageNumber };
    return { kind: 'into', pageNumber };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, select, textarea, button')) return;
    const index = active == null ? -1 : order.indexOf(active);
    const move = (to: number) => {
      const next = order[Math.min(order.length - 1, Math.max(0, to))];
      if (next != null) selection.focus(next, event.shiftKey, order);
    };

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        if (event.altKey) {
          if (active != null && !locked) onSwap(active, delta);
          return;
        }
        move(index === -1 ? 0 : index + delta);
        return;
      }
      case 'Home':
        event.preventDefault();
        move(0);
        return;
      case 'End':
        event.preventDefault();
        move(order.length - 1);
        return;
      case ' ':
        event.preventDefault();
        if (active != null) selection.toggle(active);
        return;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        if (active != null) onRename(active);
        return;
      case 'ArrowRight':
      case 'ArrowLeft':
        if (active == null || rowOf(active).screens < 2) return;
        event.preventDefault();
        if (selection.expanded.has(active) !== (event.key === 'ArrowRight')) {
          selection.toggleExpanded(active);
        }
        return;
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        if (locked) return;
        const pages = selected.size > 0 ? [...selected] : active != null ? [active] : [];
        if (pages.length > 0) onDelete(pages.sort((a, b) => a - b));
        return;
      }
      case 'Escape':
        if (selected.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        return;
      case 'a':
      case 'A':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          selection.selectAll(order);
        }
        return;
    }
  };

  const hint = verdict != null && spot != null ? verdict : null;

  return (
    <div
      ref={tableRef}
      className={`mg-table${locked ? ' mg-table-locked' : ''}`}
      role="grid"
      aria-label="Pages"
      aria-multiselectable="true"
      aria-rowcount={order.length}
      aria-busy={locked}
      tabIndex={active == null ? 0 : -1}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        // Arriving on the list itself lands on a row, so the arrows work — the
        // active one, without touching the selection: focus coming back from a
        // closed dialog must not collapse a selection of twelve pages to one.
        if (event.target !== event.currentTarget || order.length === 0) return;
        if (active != null) {
          event.currentTarget.querySelector<HTMLElement>(`[data-page="${active}"]`)?.focus();
        } else {
          selection.focus(order[0], false, order);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setSpot(null);
          setVerdict(null);
        }
      }}
    >
      <div className="mg-row mg-row-head" role="row">
        <span role="columnheader" className="mg-col-check">
          <span className="sr-only">Selected</span>
        </span>
        <span role="columnheader" className="mg-col-num">No.</span>
        <span role="columnheader" className="mg-col-thumb">
          <span className="sr-only">Preview</span>
        </span>
        <span role="columnheader" className="mg-col-title">Title</span>
        <span role="columnheader" className="mg-col-role">Role</span>
        <span role="columnheader" className="mg-col-source">Source</span>
        <span role="columnheader" className="mg-col-bar">Bottom bar</span>
        <span role="columnheader" className="mg-col-screens">Screens</span>
        <span role="columnheader" className="mg-col-status">
          <span className="sr-only">Status</span>
        </span>
      </div>

      {emptyMessage != null && <p className="mg-empty">{emptyMessage}</p>}

      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.group);
        return (
          <div key={section.group} role="rowgroup" className="mg-section">
            <div className="mg-section-head" role="row">
              <button
                type="button"
                className="mg-section-toggle"
                role="gridcell"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (!next.delete(section.group)) next.add(section.group);
                    return next;
                  })
                }
              >
                <span className="mg-chevron" aria-hidden>
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="mg-section-label">{section.label}</span>
                <span className="mg-section-count">
                  {section.pageCount} {section.pageCount === 1 ? 'page' : 'pages'}
                </span>
                <span className="mg-section-hint">{section.hint}</span>
              </button>
            </div>

            {!isCollapsed &&
              section.items.map((item) => {
                if (item.type === 'gap') {
                  const gapSpot: DropSpot = { kind: 'gap', from: item.from, to: item.to };
                  const over = sameSpot(spot, gapSpot);
                  const size = item.to - item.from + 1;
                  return (
                    <div
                      key={`gap-${item.from}`}
                      role="row"
                      className={`mg-gap${over ? (verdict?.ok ? ' mg-drop-ok' : ' mg-drop-bad') : ''}`}
                      onDragOver={(event) => hover(event, gapSpot)}
                      onDrop={(event) => drop(event, gapSpot)}
                    >
                      <span role="gridcell" className="mg-gap-label">
                        {size === 1 ? `${item.from}` : `${item.from}–${item.to}`}
                        <span className="mg-gap-free">
                          {size === 1 ? 'free' : `${size} free`}
                        </span>
                      </span>
                      {section.group === 'curated' && (
                        <button
                          type="button"
                          className="mg-gap-add"
                          disabled={locked}
                          onClick={() => onAddAt(item.from)}
                          aria-label={`Add archive pages at ${item.from}`}
                        >
                          + Add here
                        </button>
                      )}
                    </div>
                  );
                }

                const row = rowOf(item.pageNumber);
                return (
                  <PageRowView
                    key={item.pageNumber}
                    row={row}
                    selected={selected.has(item.pageNumber)}
                    active={active === item.pageNumber}
                    activeScreen={active === item.pageNumber ? selection.screen : null}
                    expanded={selection.expanded.has(item.pageNumber)}
                    dragging={dragging.has(item.pageNumber)}
                    dropZone={
                      spot != null && spot.kind !== 'gap' && spot.pageNumber === item.pageNumber
                        ? { kind: spot.kind, ok: verdict?.ok ?? false }
                        : null
                    }
                    busy={pageBusy(item.pageNumber)}
                    outcome={outcomes.get(item.pageNumber) ?? null}
                    livePage={livePage}
                    publicationAt={publicationAt}
                    locked={locked}
                    onClick={(event) =>
                      selection.click(
                        item.pageNumber,
                        { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey },
                        order,
                      )
                    }
                    onCheck={() => selection.toggle(item.pageNumber)}
                    onToggleExpanded={() => selection.toggleExpanded(item.pageNumber)}
                    onPickScreen={(screen) => {
                      selection.selectOnly(item.pageNumber);
                      selection.setScreen(screen);
                    }}
                    onDragStart={(event) => {
                      const pages = selected.has(item.pageNumber)
                        ? [...selected].sort((a, b) => a - b)
                        : [item.pageNumber];
                      if (!selected.has(item.pageNumber)) selection.selectOnly(item.pageNumber);
                      beginDrag(
                        event,
                        { kind: 'pages', pages },
                        pages.length === 1 ? `Page ${pages[0]}` : `${pages.length} pages`,
                      );
                      setDragging(new Set(pages));
                    }}
                    onDragEnd={() => {
                      clearDrag();
                      endDrag();
                    }}
                    onDragOver={(event) => hover(event, zoneOf(event, item.pageNumber))}
                    onDrop={(event) => drop(event, zoneOf(event, item.pageNumber))}
                  />
                );
              })}
          </div>
        );
      })}

      {hint != null && (
        <div className={`mg-drop-hint${hint.ok ? '' : ' mg-drop-hint-bad'}`} role="status">
          {hint.text}
        </div>
      )}
    </div>
  );
}

interface PageRowViewProps {
  row: PageRow;
  selected: boolean;
  active: boolean;
  activeScreen: number | null;
  expanded: boolean;
  dragging: boolean;
  dropZone: { kind: 'before' | 'after' | 'into'; ok: boolean } | null;
  busy: PageActionName | null;
  outcome: Notice | null;
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  publicationAt(pageNumber: number, subpage: number): PublishedEntry | null;
  locked: boolean;
  onClick(event: React.MouseEvent): void;
  onCheck(): void;
  onToggleExpanded(): void;
  onPickScreen(screen: number): void;
  onDragStart(event: DragEvent): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
}

function PageRowView({
  row,
  selected,
  active,
  activeScreen,
  expanded,
  dragging,
  dropZone,
  busy,
  outcome,
  livePage,
  publicationAt,
  locked,
  onClick,
  onCheck,
  onToggleExpanded,
  onPickScreen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: PageRowViewProps) {
  const { pageNumber } = row;
  // Read once per change of the live document, not once per render: a new
  // array every time would redraw every visible thumbnail on every click.
  const page = useMemo(() => livePage(pageNumber, 1), [livePage, pageNumber]);

  const classes = [
    'mg-row',
    `mg-kind-${row.kind}`,
    selected ? 'mg-row-selected' : '',
    active ? 'mg-row-active' : '',
    dragging ? 'mg-row-dragging' : '',
    dropZone != null ? `mg-drop-${dropZone.kind} ${dropZone.ok ? 'mg-drop-ok' : 'mg-drop-bad'}` : '',
    !row.hasContent ? 'mg-row-blank' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        className={classes}
        role="row"
        aria-selected={selected}
        data-page={pageNumber}
        tabIndex={active ? 0 : -1}
        draggable={!locked}
        onClick={onClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span role="gridcell" className="mg-col-check">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select page ${pageNumber}`}
            onClick={(event) => event.stopPropagation()}
            onChange={onCheck}
          />
        </span>
        <span role="gridcell" className="mg-col-num">
          <span className="mg-grip" aria-hidden>
            ⠿
          </span>
          {pageNumber}
        </span>
        <span role="gridcell" className="mg-col-thumb">
          <PageThumb page={page} pageNumber={pageNumber} scale={0.2} />
        </span>
        <span role="gridcell" className="mg-col-title">
          <span className="mg-title">{row.title || <em className="mg-muted">Untitled</em>}</span>
          {row.description !== '' && <span className="mg-desc">{row.description}</span>}
          {!row.hasContent && <span className="mg-warn">Draws nothing — readers skip it</span>}
        </span>
        <span role="gridcell" className="mg-col-role">
          {row.kind !== 'page' && <span className={`mg-pill mg-pill-${row.kind}`}>{KIND_LABEL[row.kind]}</span>}
        </span>
        <span role="gridcell" className="mg-col-source">
          {row.source == null ? (
            <span className="mg-muted">Hand-made</span>
          ) : (
            <>
              {row.source}
              {row.topic != null && <span className="mg-muted"> · {row.topic}</span>}
            </>
          )}
        </span>
        <span role="gridcell" className={`mg-col-bar mg-bar-${row.bar.kind}`}>
          {describeBar(row.bar)}
          {row.shift === false && <span className="mg-muted" title="Not shifted down"> · ⇧</span>}
        </span>
        <span role="gridcell" className="mg-col-screens">
          {row.screens > 1 ? (
            <button
              type="button"
              className="mg-screens-toggle"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} the ${row.screens} screens of page ${pageNumber}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
            >
              <span aria-hidden>{expanded ? '▾' : '▸'}</span> {row.screens}
            </button>
          ) : (
            <span className="mg-muted">1</span>
          )}
        </span>
        <span role="gridcell" className="mg-col-status">
          {busy != null ? (
            <span className="mg-spinner" role="img" aria-label="Working" />
          ) : outcome?.tone === 'alert' ? (
            <span className="mg-status-bad" role="img" aria-label={outcome.text} title={outcome.text}>
              !
            </span>
          ) : row.showcased ? (
            <span className="mg-star" role="img" aria-label="On the front page" title="On the front page">
              ★
            </span>
          ) : null}
        </span>
      </div>

      {expanded &&
        Array.from({ length: row.screens }, (_, index) => index + 1).map((screen) => (
          <ScreenRow
            key={`${pageNumber}.${screen}`}
            pageNumber={pageNumber}
            screen={screen}
            count={row.screens}
            current={activeScreen === screen}
            livePage={livePage}
            record={publicationAt(pageNumber, screen)}
            onPick={() => onPickScreen(screen)}
          />
        ))}
    </>
  );
}

function ScreenRow({
  pageNumber,
  screen,
  count,
  current,
  livePage,
  record,
  onPick,
}: {
  pageNumber: number;
  screen: number;
  count: number;
  current: boolean;
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  record: PublishedEntry | null;
  onPick(): void;
}) {
  const page = useMemo(() => livePage(pageNumber, screen), [livePage, pageNumber, screen]);
  return (
    <div
      className={`mg-row mg-row-screen${current ? ' mg-row-screen-current' : ''}`}
      role="row"
      onClick={onPick}
    >
      <span role="gridcell" className="mg-col-check" />
      <span role="gridcell" className="mg-col-num mg-muted">
        {screen}/{count}
      </span>
      <span role="gridcell" className="mg-col-thumb">
        <PageThumb page={page} pageNumber={pageNumber} subpage={screen} subpageCount={count} scale={0.2} />
      </span>
      <span role="gridcell" className="mg-col-title mg-muted">
        Screen {screen}
      </span>
      <span role="gridcell" className="mg-col-role" />
      <span role="gridcell" className="mg-col-source">
        {record == null ? (
          <span className="mg-muted">Hand-made</span>
        ) : (
          `${record.source.toUpperCase()} ${record.original_page}${record.sub ? `-${record.sub}` : ''}`
        )}
      </span>
      <span role="gridcell" className="mg-col-bar">
        {record == null ? '—' : record.menu_name ?? 'Own row'}
      </span>
      <span role="gridcell" className="mg-col-screens" />
      <span role="gridcell" className="mg-col-status" />
    </div>
  );
}
