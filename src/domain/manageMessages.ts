/**
 * What the manage screen says, and in what tone.
 *
 * Every outcome the screen reports used to be a bare string set on one `notice`
 * state, announced through `role="status"` whether it was "Page 204 deleted." or
 * a publish failure — so a screen reader could not tell a success from a
 * disaster, and neither could a glance.
 *
 * A {@link Notice} carries a tone as well as text, and the builders here are the
 * only place either is decided. That has a second benefit: the requirements say
 * what a message must *name* — an action, a page number, a reason — not what it
 * must read like, so the wording can change here without touching a component,
 * and the tests assert against these builders rather than against literal
 * strings buried in JSX.
 *
 * Pure and framework-free. `describeRejection` in `publication.ts` already owns
 * the publish-range prose and is reused rather than restated.
 */

import type { PageKind } from './directory';
import type { PageActionName } from './inFlight';
import type { OnAirFilter } from './onAirList';
import { describeRejection } from './publication';

/** Whether a message is routine or needs interrupting for. */
export type NoticeTone = 'status' | 'alert';

/** One thing the screen has to say. */
export interface Notice {
  tone: NoticeTone;
  text: string;
}

/** A destructive action awaiting confirmation. */
export interface ConfirmRequest {
  action: 'delete' | 'unpublish';
  pageNumber: number;
  /** The page's title, for naming what is about to go. */
  title: string;
}

const status = (text: string): Notice => ({ tone: 'status', text });
const alert = (text: string): Notice => ({ tone: 'alert', text });

/** What a page action is called, for a button or a report. */
export function actionLabel(action: PageActionName): string {
  switch (action) {
    case 'nudge-lower':
      return 'Move one page earlier';
    case 'nudge-higher':
      return 'Move one page later';
    case 'move-to':
      return 'Move to a page number';
    case 'unpublish':
      return 'Unpublish';
    case 'delete':
      return 'Delete';
    case 'save-text':
      return 'Save text';
    case 'set-role':
      return 'Set directory role';
    case 'add-subpage':
      return 'Add a subpage';
    case 'remove-subpage':
      return 'Remove the last subpage';
    case 'absorb-page':
      return 'Fold a page in as a subpage';
  }
}

/** What a page action says while it is running. */
export function actionProgress(action: PageActionName): string {
  switch (action) {
    case 'nudge-lower':
    case 'nudge-higher':
    case 'move-to':
      return 'Moving…';
    case 'unpublish':
      return 'Unpublishing…';
    case 'delete':
      return 'Deleting…';
    case 'save-text':
      return 'Saving…';
    case 'set-role':
      return 'Setting role…';
    case 'add-subpage':
      return 'Adding a subpage…';
    case 'remove-subpage':
      return 'Removing the last subpage…';
    case 'absorb-page':
      return 'Folding the page in…';
  }
}

/** What a page action says once it has worked. */
export function actionDone(action: PageActionName): string {
  switch (action) {
    case 'nudge-lower':
    case 'nudge-higher':
    case 'move-to':
      return 'moved';
    case 'unpublish':
      return 'unpublished';
    case 'delete':
      return 'deleted';
    case 'save-text':
      return 'text saved';
    case 'set-role':
      return 'directory role set';
    case 'add-subpage':
      return 'given another subpage';
    case 'remove-subpage':
      return 'one subpage shorter';
    case 'absorb-page':
      return 'given the page as a subpage';
  }
}

export function pageActionSucceeded(
  action: PageActionName,
  pageNumber: number,
): Notice {
  return status(`Page ${pageNumber} ${actionDone(action)}.`);
}

export function pageActionFailed(
  action: PageActionName,
  pageNumber: number,
  reason?: string,
): Notice {
  const because = reason == null || reason.length === 0 ? '' : ` ${reason}`;
  return alert(
    `${actionLabel(action)} did not complete for page ${pageNumber}.${because}`,
  );
}

export function roleChanged(pageNumber: number, kind: PageKind): Notice {
  return status(`Page ${pageNumber} is now a ${kind}.`);
}

export function publishSucceeded(pageNumber: number): Notice {
  return status(`Published to page ${pageNumber}.`);
}

export function publishFailed(pageNumber: number, reason?: string): Notice {
  const because = reason == null || reason.length === 0 ? '' : ` ${reason}`;
  return alert(`Publishing to page ${pageNumber} did not complete.${because}`);
}

/** A whole run of captures published onto consecutive pages. */
export function batchPublished(count: number, startPage: number): Notice {
  return status(
    count === 1
      ? `Published to page ${startPage}.`
      : `Published ${count} pages, ${startPage} to ${startPage + count - 1}.`,
  );
}

/** New transforms re-applied to a run of pages already on air. */
export function transformsApplied(pageNumbers: readonly number[]): Notice {
  return status(
    pageNumbers.length === 1
      ? `Page ${pageNumbers[0]} re-published with the new transforms.`
      : `${pageNumbers.length} pages re-published with the new transforms.`,
  );
}

/** A publish target outside the curated range. Reuses the domain's own prose. */
export function publishTargetOutOfRange(): Notice {
  return alert(describeRejection('page-out-of-range'));
}

/** A capture that is catalogued but cannot be rendered. */
export function captureNotPublishable(decodeStatus: string): Notice {
  return alert(
    `This capture's decode status is "${decodeStatus}", so there is nothing to ` +
      'publish until its render profile exists.',
  );
}

export function reorderSucceeded(text: string): Notice {
  return status(text);
}

export function reorderFailed(reason: string): Notice {
  return alert(reason);
}

/** Make room / close gap, which moves a whole run of pages. */
export function roomMade(fromPage: number, delta: number): Notice {
  return status(
    `Pages from ${fromPage} moved by ${delta > 0 ? '+' : ''}${delta}.`,
  );
}

/** A block move, which is also how a single-page nudge is carried out. */
export function blockMoved(start: number, end: number, destination: number): Notice {
  return status(
    start === end
      ? `Page ${start} is now ${destination}.`
      : `Pages ${start}–${end} now start at ${destination}.`,
  );
}

export function textTooLong(field: 'title' | 'description', limit: number): Notice {
  return alert(`The ${field} must be ${limit} characters or fewer. Nothing was saved.`);
}

/** The selected capture has fallen out of the restored results. */
export function captureSelectionLost(): Notice {
  return status('The capture you had selected is no longer in these results.');
}

/** Name the restrictions in force, for an empty list or a counter. */
export function describeOnAirFilter(filter: OnAirFilter): string {
  const parts: string[] = [];
  const term = filter.text.trim();
  if (term.length > 0) parts.push(`matching “${term}”`);
  if (filter.publication === 'published') parts.push('published from the archive');
  if (filter.publication === 'hand-made') parts.push('made by hand');
  if (filter.range === 'curated') parts.push('in 100–699');
  if (filter.range === 'playground') parts.push('in 700–999');
  return parts.length === 0 ? 'with no filter in force' : parts.join(', ');
}

/** No page survived the on-air filter. */
export function noOnAirMatch(filter: OnAirFilter): string {
  return `No page on air is ${describeOnAirFilter(filter)}.`;
}

/** The capture filter values, structurally — kept out of the collab layer. */
export interface CaptureFilterValues {
  source?: string;
  topic?: string;
  topicGroup?: string;
  scheme?: string;
  page?: number;
  q?: string;
  undecoded?: boolean;
}

/** Name every capture filter in force, so an empty result explains itself. */
export function describeCaptureFilters(filters: CaptureFilterValues): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`text “${filters.q}”`);
  if (filters.topicGroup) parts.push(`topic ${filters.topicGroup}`);
  if (filters.topic) parts.push(`topic ${filters.topic}`);
  if (filters.source) parts.push(`source ${filters.source.toUpperCase()}`);
  if (filters.scheme) parts.push(`era ${filters.scheme}`);
  if (filters.page) parts.push(`original page ${filters.page}`);
  parts.push(
    filters.undecoded
      ? 'including captures that cannot be decoded'
      : 'decodable captures only',
  );
  return parts.join(', ');
}

/** No capture matched. */
export function noCaptureMatch(filters: CaptureFilterValues): string {
  return `No capture matches ${describeCaptureFilters(filters)}.`;
}

/**
 * What a destructive action takes, spelled out before it is taken.
 *
 * Delete and unpublish differ in what survives — a deleted page loses its
 * directory role, an unpublished one loses its record — and the difference is
 * exactly what the operator needs to know, so the two are written separately
 * rather than sharing one hedge.
 */
export function confirmHeading(request: ConfirmRequest): string {
  return request.action === 'delete'
    ? `Delete page ${request.pageNumber}?`
    : `Unpublish page ${request.pageNumber}?`;
}

export function confirmBody(request: ConfirmRequest): string {
  const named =
    request.title.trim().length > 0 ? `“${request.title.trim()}”` : 'This untitled page';

  return request.action === 'delete'
    ? `${named} loses its content, its title, its description and its directory ` +
        'role. This cannot be undone from here — only from a backup.'
    : `${named} loses its publication record, and its content, title and ` +
        'description are cleared. This cannot be undone from here — only from a backup.';
}

export function confirmLabel(request: ConfirmRequest): string {
  return request.action === 'delete' ? 'Delete the page' : 'Unpublish the page';
}
