/**
 * Everything about the selected page, and every change that can be made to it.
 *
 * One place per page rather than a row of buttons on every card: the list
 * stays scannable, and the controls here can be full size and labelled. Edits
 * apply the moment they are made — a title when the field is left, a bar when
 * it is picked — the way a properties panel does, with the row showing the
 * change straight away. Only what cannot be undone asks first.
 */

import { useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import { PAGE_KINDS, type PageKind } from '../../domain/directory';
import type { PageActionName } from '../../domain/inFlight';
import type { CustomMenu } from '../../domain/menu';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';
import { MAX_SUBPAGE } from '../../domain/subpages';
import { suggestTitle } from '../../domain/suggestTitle';
import type { TeletextPage } from '../../types/teletext';
import type { DropVerdict } from './LineupTable';
import { KIND_NAMES, type PageRow } from './lineupModel';
import { MenuStrip } from './MenuStrip';
import { PageThumb } from './PageThumb';


export interface InspectorProps {
  row: PageRow;
  screen: number;
  setScreen(screen: number): void;
  records: readonly PublishedEntry[];
  livePage(pageNumber: number, subpage?: number): TeletextPage | null;
  menus: readonly CustomMenu[];
  busy: PageActionName | null;
  /** A structural action is running. */
  locked: boolean;
  isShowcased(pageNumber: number, subpage: number): boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  checkMove(target: number): DropVerdict;
  onMove(target: number): void;
  checkFold(source: number): DropVerdict;
  onFold(source: number): void;
  onSaveText(title: string, description: string): void;
  onSetRole(kind: PageKind): void;
  onSetBar(menuId: number | null): void;
  onSetShift(shift: boolean): void;
  onAddEmptyScreen(): void;
  onRemoveLastScreen(): void;
  onAddScreensFromArchive(): void;
  onReplaceScreen(screen: number): void;
  onToggleShowcase(screen: number, on: boolean): void;
  onDelete(): void;
  onClose(): void;
}

export function Inspector({
  row,
  screen: requestedScreen,
  setScreen,
  records,
  livePage,
  menus,
  busy,
  locked,
  isShowcased,
  titleRef,
  checkMove,
  onMove,
  checkFold,
  onFold,
  onSaveText,
  onSetRole,
  onSetBar,
  onSetShift,
  onAddEmptyScreen,
  onRemoveLastScreen,
  onAddScreensFromArchive,
  onReplaceScreen,
  onToggleShowcase,
  onDelete,
  onClose,
}: InspectorProps) {
  const { pageNumber } = row;
  const disabled = locked || busy != null;
  // Clamped on read: the count is shared, and another moderator removing a
  // screen must not leave this pointing at one that is gone.
  const screen = Math.min(requestedScreen, row.screens);
  const record = records.find((entry) => (entry.subpage ?? 1) === screen) ?? null;
  const showcased = isShowcased(pageNumber, screen);

  // Drafts exist only while a field is being edited, so a change made by
  // someone else shows up in a field nobody is typing in.
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [fold, setFold] = useState('');

  const commitText = (nextTitle: string | null, nextDescription: string | null) => {
    const t = (nextTitle ?? row.title).trim();
    const d = (nextDescription ?? row.description).trim();
    if (t !== row.title.trim() || d !== row.description.trim()) onSaveText(t, d);
  };

  const target = Number(number);
  const moveVerdict = number.trim() === '' ? null : checkMove(target);
  const foldVerdict = fold.trim() === '' ? null : checkFold(Number(fold));

  const barValue =
    row.bar.kind === 'menu' ? String(row.bar.id) : row.bar.kind === 'own' ? 'own' : 'mixed';

  return (
    <aside className="mg-inspector" aria-label={`Page ${pageNumber}`}>
      <header className="mg-insp-head">
        <div className="mg-insp-number">{pageNumber}</div>
        <div className="mg-insp-links">
          <Link className="mg-btn mg-btn-small" to={`/edit/${pageNumber}/${screen}`}>
            Edit content
          </Link>
          <Link className="mg-btn mg-btn-small mg-btn-ghost" to={`/watch/${pageNumber}/${screen}`} target="_blank">
            View ↗
          </Link>
          <button type="button" className="mg-icon-btn" aria-label="Close details" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      <section className="mg-insp-section">
        <div className="mg-field">
          <span className="mg-label-row">
            <label className="mg-label" htmlFor={`mg-title-${pageNumber}`}>
              Title
            </label>
            <button
              type="button"
              className="mg-link"
              disabled={locked}
              title="Read a title off the top of screen 1 — review it, then press Enter"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const cells = livePage(pageNumber, 1);
                const suggestion = cells == null ? '' : suggestTitle(cells);
                if (suggestion === '') return;
                titleRef.current?.focus();
                setTitle(suggestion);
              }}
            >
              Suggest
            </button>
            <span className="mg-count">{(title ?? row.title).length}/{MAX_TITLE_LENGTH}</span>
          </span>
          <input
            ref={titleRef}
            id={`mg-title-${pageNumber}`}
            className="mg-input"
            maxLength={MAX_TITLE_LENGTH}
            value={title ?? row.title}
            placeholder="Untitled"
            disabled={locked}
            onFocus={() => setTitle(row.title)}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              commitText(title, null);
              setTitle(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setTitle(row.title);
                // Blur after the revert has rendered, so nothing is saved.
                const input = event.currentTarget;
                requestAnimationFrame(() => input.blur());
              }
            }}
          />
        </div>

        <label className="mg-field">
          <span className="mg-label">
            Description{' '}
            <span className="mg-count">
              {(description ?? row.description).length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </span>
          <textarea
            className="mg-input"
            rows={2}
            maxLength={MAX_DESCRIPTION_LENGTH}
            value={description ?? row.description}
            placeholder="Shown in the Yellow Pages and search"
            disabled={locked}
            onFocus={() => setDescription(row.description)}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              commitText(null, description);
              setDescription(null);
            }}
          />
        </label>

        <div className="mg-field-row">
          <label className="mg-field">
            <span className="mg-label">Directory role</span>
            <select
              className="mg-input"
              value={row.kind}
              disabled={disabled}
              onChange={(event) => onSetRole(event.target.value as PageKind)}
            >
              {PAGE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_NAMES[kind]}
                </option>
              ))}
            </select>
          </label>

          <form
            className="mg-field"
            onSubmit={(event) => {
              event.preventDefault();
              if (moveVerdict?.ok) {
                onMove(target);
                setNumber('');
              }
            }}
          >
            <label className="mg-label" htmlFor={`mg-move-${pageNumber}`}>
              Move to number
            </label>
            <span className="mg-inline">
              <input
                id={`mg-move-${pageNumber}`}
                className="mg-input mg-input-num"
                inputMode="numeric"
                placeholder={String(pageNumber)}
                value={number}
                disabled={disabled}
                onChange={(event) => setNumber(event.target.value.replace(/\D/g, '').slice(0, 3))}
              />
              <button type="submit" className="mg-btn mg-btn-small" disabled={disabled || !moveVerdict?.ok}>
                Move
              </button>
            </span>
          </form>
        </div>
        {moveVerdict != null && (
          <p className={`mg-note${moveVerdict.ok ? '' : ' mg-note-bad'}`} role="status">
            {moveVerdict.text}
          </p>
        )}
      </section>

      <section className="mg-insp-section" aria-label="Screens">
        <div className="mg-insp-subhead">
          <h3 className="mg-h3">
            Screens <span className="mg-muted">{row.screens}</span>
          </h3>
          <span className="mg-inline">
            <button
              type="button"
              className="mg-btn mg-btn-small"
              disabled={disabled || row.screens >= MAX_SUBPAGE || pageNumber >= 700}
              title={pageNumber >= 700 ? 'Archive captures only go on 100–699' : undefined}
              onClick={onAddScreensFromArchive}
            >
              + From archive
            </button>
            <button
              type="button"
              className="mg-btn mg-btn-small mg-btn-ghost"
              disabled={disabled || row.screens >= MAX_SUBPAGE}
              onClick={onAddEmptyScreen}
            >
              + Empty
            </button>
          </span>
        </div>

        <div className="mg-screens" role="listbox" aria-label={`Screens of page ${pageNumber}`}>
          {Array.from({ length: row.screens }, (_, index) => index + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={n === screen}
              className={`mg-screen${n === screen ? ' mg-screen-current' : ''}`}
              onClick={() => setScreen(n)}
            >
              <PageThumb page={livePage(pageNumber, n)} pageNumber={pageNumber} subpage={n} subpageCount={row.screens} scale={0.2} />
              <span className="mg-screen-label">
                {n}
                {isShowcased(pageNumber, n) && <span className="mg-star"> ★</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="mg-preview">
          <PageThumb
            page={livePage(pageNumber, screen)}
            pageNumber={pageNumber}
            subpage={screen}
            subpageCount={row.screens}
            scale={1}
            alt={`Page ${pageNumber}, screen ${screen}`}
          />
        </div>

        <p className="mg-note">
          {record == null
            ? `Screen ${screen} was made by hand.`
            : `Screen ${screen} · ${record.source.toUpperCase()} ${record.original_page}${
                record.sub ? `-${record.sub}` : ''
              }${record.topic ? ` · ${record.topic}` : ''}${
                record.first_seen ? ` · ${record.first_seen.slice(0, 10)}` : ''
              }`}
        </p>

        <div className="mg-inline mg-wrap">
          <button
            type="button"
            className={`mg-btn mg-btn-small${showcased ? ' mg-btn-on' : ''}`}
            disabled={disabled || pageNumber >= 700}
            aria-pressed={showcased}
            title={showcased ? 'Take this screen off the front page' : 'Draw this screen now and put it on the front page'}
            onClick={() => onToggleShowcase(screen, showcased)}
          >
            {showcased ? '★ On the front page' : '☆ Add to front page'}
          </button>
          <button
            type="button"
            className="mg-btn mg-btn-small mg-btn-ghost"
            disabled={disabled || pageNumber >= 700}
            onClick={() => onReplaceScreen(screen)}
          >
            Replace from archive
          </button>
          <button
            type="button"
            className="mg-btn mg-btn-small mg-btn-ghost"
            disabled={disabled || row.screens < 2}
            title={row.screens < 2 ? 'Screen 1 is the page itself' : `Delete screen ${row.screens}`}
            onClick={onRemoveLastScreen}
          >
            − Remove screen {row.screens}
          </button>
        </div>

        <form
          className="mg-field"
          onSubmit={(event) => {
            event.preventDefault();
            if (foldVerdict?.ok) {
              onFold(Number(fold));
              setFold('');
            }
          }}
        >
          <label className="mg-label" htmlFor={`mg-fold-${pageNumber}`}>
            Fold another page in as screens
          </label>
          <span className="mg-inline">
            <input
              id={`mg-fold-${pageNumber}`}
              className="mg-input mg-input-num"
              inputMode="numeric"
              placeholder="e.g. 118"
              value={fold}
              disabled={disabled}
              onChange={(event) => setFold(event.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <button type="submit" className="mg-btn mg-btn-small" disabled={disabled || !foldVerdict?.ok}>
              Fold in
            </button>
          </span>
          {foldVerdict != null && (
            <p className={`mg-note${foldVerdict.ok ? '' : ' mg-note-bad'}`} role="status">
              {foldVerdict.text}
            </p>
          )}
        </form>
      </section>

      <section className="mg-insp-section" aria-label="Bottom bar">
        <h3 className="mg-h3">Bottom bar</h3>
        {row.archiveScreens === 0 ? (
          <p className="mg-note">
            Made by hand, so its bottom row is whatever was drawn. Change it in the editor.
          </p>
        ) : (
          <>
            <label className="mg-field">
              <span className="mg-label">
                Last row of {row.archiveScreens === 1 ? 'the archive screen' : `all ${row.archiveScreens} archive screens`}
              </span>
              <select
                className="mg-input"
                value={barValue}
                disabled={disabled}
                onChange={(event) =>
                  onSetBar(event.target.value === 'own' ? null : Number(event.target.value))
                }
              >
                {barValue === 'mixed' && (
                  <option value="mixed" disabled>
                    Mixed — pick one for every screen
                  </option>
                )}
                <option value="own">The capture’s own row</option>
                {menus.map((menu) => (
                  <option key={menu.id} value={menu.id}>
                    {menu.name}
                  </option>
                ))}
              </select>
            </label>
            {row.bar.kind === 'menu' &&
              (() => {
                const id = row.bar.id;
                const menu = menus.find((m) => m.id === id);
                return menu == null ? null : <MenuStrip items={menu.items} label={`${menu.name} preview`} />;
              })()}

            <label className="mg-check">
              <input
                type="checkbox"
                checked={row.shift === true}
                ref={(input) => {
                  if (input != null) input.indeterminate = row.shift === 'mixed';
                }}
                disabled={disabled}
                onChange={(event) => onSetShift(event.target.checked)}
              />
              <span>
                Shift down one row
                <span className="mg-muted"> — clears the header row, drops the capture’s last row</span>
              </span>
            </label>
            {row.edited && (
              <p className="mg-note mg-note-warn">
                Edited by hand since it was published. Changing the bar or the shift publishes it again from the
                archive, which undoes those edits.
              </p>
            )}
            {row.shift === true && row.bar.kind === 'own' && (
              <p className="mg-note mg-note-warn">
                Shifted, the capture’s own bottom row falls off the page — so there is no bar. Pick a saved bar,
                or untick the shift to keep the original one.
              </p>
            )}
          </>
        )}
      </section>

      <section className="mg-insp-section mg-insp-danger">
        <button type="button" className="mg-btn mg-btn-danger-ghost" disabled={disabled} onClick={onDelete}>
          Delete page {pageNumber}…
        </button>
      </section>
    </aside>
  );
}
