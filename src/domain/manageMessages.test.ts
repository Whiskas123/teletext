/**
 * Tests for what the manage screen says.
 *
 * These assert the two things the requirements actually pin down — the tone, and
 * that the message names the page it is about — rather than the wording, which
 * is a design decision and free to change. That is the whole reason the builders
 * exist separately from the components.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PAGE_KINDS } from './directory';
import type { PageActionName } from './inFlight';
import {
  actionDone,
  actionLabel,
  describeCaptureFilters,
  noCaptureMatch,
  pageActionFailed,
  pageActionSucceeded,
  roleChanged,
  textTooLong,
} from './manageMessages';

const ACTIONS: readonly PageActionName[] = [
  'nudge-lower',
  'nudge-higher',
  'unpublish',
  'delete',
  'save-text',
  'set-role',
];

const arbAction = fc.constantFrom(...ACTIONS);
const arbPage = fc.integer({ min: 100, max: 999 });

describe('tone', () => {
  it('reports every success as a status', () => {
    fc.assert(
      fc.property(arbAction, arbPage, (action, pageNumber) => {
        expect(pageActionSucceeded(action, pageNumber).tone).toBe('status');
      }),
    );
  });

  it('reports every failure as an alert', () => {
    fc.assert(
      fc.property(arbAction, arbPage, (action, pageNumber) => {
        expect(pageActionFailed(action, pageNumber).tone).toBe('alert');
      }),
    );
    expect(textTooLong('title', 60).tone).toBe('alert');
  });
});

describe('naming the page', () => {
  it('names the page number in every page-scoped message', () => {
    fc.assert(
      fc.property(arbAction, arbPage, (action, pageNumber) => {
        const number = String(pageNumber);
        expect(pageActionSucceeded(action, pageNumber).text).toContain(number);
        expect(pageActionFailed(action, pageNumber).text).toContain(number);
      }),
    );
  });

  it('names the action that failed, so two failures are distinguishable', () => {
    fc.assert(
      fc.property(arbAction, arbPage, (action, pageNumber) => {
        expect(pageActionFailed(action, pageNumber).text).toContain(actionLabel(action));
      }),
    );
  });

  it('carries the underlying reason when there is one', () => {
    const notice = pageActionFailed('delete', 412, 'Could not reach the server.');
    expect(notice.text).toContain('Could not reach the server.');
  });

  it('names the page and the new role when a role changes', () => {
    fc.assert(
      fc.property(arbPage, fc.constantFrom(...PAGE_KINDS), (pageNumber, kind) => {
        const notice = roleChanged(pageNumber, kind);
        expect(notice.tone).toBe('status');
        expect(notice.text).toContain(String(pageNumber));
        expect(notice.text).toContain(kind);
      }),
    );
  });
});

describe('action labels', () => {
  it('gives every action a distinct label and a done form', () => {
    const labels = new Set(ACTIONS.map(actionLabel));
    expect(labels.size).toBe(ACTIONS.length);
    for (const action of ACTIONS) {
      expect(actionDone(action).length).toBeGreaterThan(0);
    }
  });
});

describe('describeCaptureFilters', () => {
  it('names every value in force so an empty result explains itself', () => {
    const described = describeCaptureFilters({
      q: 'lisboa',
      topicGroup: 'noticias',
      source: 'rtp',
      scheme: '1998-2000',
      page: 220,
      undecoded: true,
    });

    expect(described).toContain('lisboa');
    expect(described).toContain('noticias');
    expect(described).toContain('RTP');
    expect(described).toContain('1998-2000');
    expect(described).toContain('220');
    expect(described).toContain('cannot be decoded');

    expect(noCaptureMatch({})).toContain('decodable captures only');
  });
});
