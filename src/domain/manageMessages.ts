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
 * Pure and framework-free. Messages that only one action ever says — a
 * renumbering's summary, a batch's count — are written where that action is
 * (`components/Manage/useManageActions.ts`); what is here is shared.
 */

import type { PageKind } from './directory';
import type { PageActionName } from './inFlight';

/** Whether a message is routine or needs interrupting for. */
export type NoticeTone = 'status' | 'alert';

/** One thing the screen has to say. */
export interface Notice {
  tone: NoticeTone;
  text: string;
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
    case 'showcase':
      return 'Change the front page';
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
    case 'showcase':
      return 'front page updated';
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

export function textTooLong(field: 'title' | 'description', limit: number): Notice {
  return alert(`The ${field} must be ${limit} characters or fewer. Nothing was saved.`);
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
  unpublished?: boolean;
  latest?: boolean;
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
  if (filters.unpublished) parts.push('not yet published');
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
