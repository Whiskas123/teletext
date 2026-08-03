/**
 * Previewing a capture and putting it on a page.
 *
 * ## Two previews, because publishing replaces something
 *
 * The capture as it will be published — transforms applied — beside whatever is
 * on the target page right now, read from the live document rather than the
 * database so it includes any collaborative edits. Publishing is destructive to
 * that page, so it is worth seeing what goes.
 *
 * Previews are scaled to fit their column rather than cropped: a teletext page is
 * 40 cells wide and only means anything whole.
 */

import type { CustomMenu, MenuDraft } from '../../domain/menu';
import type {
  CaptureSummary,
  PublishedEntry,
} from '../../collab/useArchiveAdmin';
import { lastRowHasContent } from '../../domain/pageTransform';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  describeRejection,
  isPublishablePage,
} from '../../domain/publication';
import { createEmptyPage, type TeletextPage } from '../../types/teletext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import { MenuEditor } from './MenuEditor';
import { blockedReason } from './captureMeta';

export interface PublishDraft {
  pageNumber: string;
  title: string;
  description: string;
  shiftDown: boolean;
  menuId: number | null;
}

export interface PublishPanelProps {
  selected: CaptureSummary | null;
  /** The capture's own cells, or null while they are still being fetched. */
  sourcePage: TeletextPage | null;
  /** Those cells with the publish transforms applied — what will land. */
  outgoing: TeletextPage | null;
  /** What is on the target page now, read live. */
  current: TeletextPage | null;
  targetEntry: PublishedEntry | null;
  draft: PublishDraft;
  onDraft(patch: Partial<PublishDraft>): void;
  menus: CustomMenu[];
  onSaveMenu(draft: MenuDraft & { id?: number }): Promise<{ ok: true } | { ok: false; error: string }>;
  onDeleteMenu(id: number): Promise<{ ok: true } | { ok: false; error: string }>;
  publishBusy: boolean;
  onPublish(): void;
}

export function PublishPanel({
  selected,
  sourcePage,
  outgoing,
  current,
  targetEntry,
  draft,
  onDraft,
  menus,
  onSaveMenu,
  onDeleteMenu,
  publishBusy,
  onPublish,
}: PublishPanelProps) {
  if (selected == null) {
    return (
      <section className="manage-detail" aria-label="Selected capture">
        <p className="landing-section-description">
          Pick a capture to preview and publish it.
        </p>
      </section>
    );
  }

  const target = Number(draft.pageNumber);
  const targetValid = Number.isInteger(target) && isPublishablePage(target);
  const blocked = blockedReason(selected);
  const wouldLoseRow =
    sourcePage != null && draft.shiftDown && lastRowHasContent(sourcePage);

  return (
    <section className="manage-detail" aria-label="Selected capture">
      <div className="manage-compare">
        <div>
          <h3 className="manage-compare-title">
            Will be published to {targetValid ? target : '—'}
          </h3>
          <div className="manage-preview">
            <TeletextGrid page={outgoing ?? createEmptyPage()} readOnly />
          </div>
        </div>
        <div>
          <h3 className="manage-compare-title">
            {current == null ? 'That page is empty' : 'That page shows now'}
          </h3>
          <div
            className={`manage-preview${current == null ? ' manage-preview-empty' : ''}`}
          >
            <TeletextGrid page={current ?? createEmptyPage()} readOnly />
          </div>
          {targetEntry != null && (
            <p className="manage-note">
              Published {targetEntry.published_at.slice(0, 10)} from{' '}
              {targetEntry.source.toUpperCase()} {targetEntry.original_page}
              {targetEntry.sub ? `-${targetEntry.sub}` : ''}
              {targetEntry.title ? ` — “${targetEntry.title}”` : ''}
            </p>
          )}
          {current != null && targetEntry == null && (
            // Content with no publication record is someone's own work, not
            // something re-publishable from the corpus.
            <p className="manage-note manage-note-error">
              Not published from the archive — this page was edited by hand.
            </p>
          )}
        </div>
      </div>

      {blocked != null && (
        <p className="room-entry-error" role="status">
          {blocked} — catalogued, but not publishable until its render profile
          exists. Decode status: {selected.decode_status}.
        </p>
      )}

      <label className="manage-checkbox">
        <input
          type="checkbox"
          checked={draft.shiftDown}
          onChange={(e) => onDraft({ shiftDown: e.target.checked })}
        />
        Shift down one row (drops the last row)
      </label>
      {wouldLoseRow && (
        <p className="manage-note">
          The last row has content and will be discarded — which is the point when
          it is a duplicate menu strip, but worth a look first.
        </p>
      )}

      <MenuEditor
        menus={menus}
        selectedId={draft.menuId}
        onSelect={(menuId) => onDraft({ menuId })}
        onSave={onSaveMenu}
        onDelete={onDeleteMenu}
      />

      <label className="sidebar-field-label" htmlFor="manage-target">
        Publish to page
      </label>
      <input
        id="manage-target"
        type="number"
        min={100}
        max={699}
        className="landing-name-input"
        value={draft.pageNumber}
        onChange={(e) => onDraft({ pageNumber: e.target.value })}
      />
      {!targetValid && draft.pageNumber !== '' && (
        <p className="manage-note manage-note-error" role="status">
          {describeRejection('page-out-of-range')}
        </p>
      )}

      <label className="sidebar-field-label" htmlFor="manage-title">
        Title ({draft.title.length}/{MAX_TITLE_LENGTH})
      </label>
      <input
        id="manage-title"
        className="landing-name-input"
        maxLength={MAX_TITLE_LENGTH}
        value={draft.title}
        onChange={(e) => onDraft({ title: e.target.value })}
      />

      <label className="sidebar-field-label" htmlFor="manage-description">
        Description ({draft.description.length}/{MAX_DESCRIPTION_LENGTH})
      </label>
      <textarea
        id="manage-description"
        className="landing-name-input"
        rows={3}
        maxLength={MAX_DESCRIPTION_LENGTH}
        value={draft.description}
        onChange={(e) => onDraft({ description: e.target.value })}
      />

      <button
        type="button"
        className="sidebar-action-btn"
        disabled={publishBusy || blocked != null || !targetValid}
        onClick={onPublish}
      >
        {publishBusy
          ? 'Publishing…'
          : current == null
            ? 'Publish'
            : 'Replace what is there'}
      </button>
    </section>
  );
}
