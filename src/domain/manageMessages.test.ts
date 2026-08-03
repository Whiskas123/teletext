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
  EMPTY_ON_AIR_FILTER,
  type OnAirFilter,
} from './onAirList';
import {
  actionDone,
  actionLabel,
  actionProgress,
  blockMoved,
  captureNotPublishable,
  captureSelectionLost,
  confirmBody,
  confirmHeading,
  confirmLabel,
  describeCaptureFilters,
  describeOnAirFilter,
  noCaptureMatch,
  noOnAirMatch,
  pageActionFailed,
  pageActionSucceeded,
  publishFailed,
  publishSucceeded,
  publishTargetOutOfRange,
  roleChanged,
  roomMade,
  textTooLong,
  type ConfirmRequest,
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
    fc.assert(
      fc.property(arbPage, (pageNumber) => {
        expect(publishSucceeded(pageNumber).tone).toBe('status');
      }),
    );
  });

  it('reports every failure as an alert', () => {
    fc.assert(
      fc.property(arbAction, arbPage, (action, pageNumber) => {
        expect(pageActionFailed(action, pageNumber).tone).toBe('alert');
      }),
    );
    fc.assert(
      fc.property(arbPage, (pageNumber) => {
        expect(publishFailed(pageNumber).tone).toBe('alert');
      }),
    );
    expect(publishTargetOutOfRange().tone).toBe('alert');
    expect(captureNotPublishable('failed').tone).toBe('alert');
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
        expect(publishSucceeded(pageNumber).text).toContain(number);
        expect(publishFailed(pageNumber).text).toContain(number);
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
  it('gives every action a distinct label, a progress form and a done form', () => {
    const labels = new Set(ACTIONS.map(actionLabel));
    expect(labels.size).toBe(ACTIONS.length);
    for (const action of ACTIONS) {
      expect(actionProgress(action).length).toBeGreaterThan(0);
      expect(actionDone(action).length).toBeGreaterThan(0);
    }
  });
});

describe('reorder messages', () => {
  it('names the destination for a single page and a block alike', () => {
    expect(blockMoved(204, 204, 203).text).toContain('203');
    expect(blockMoved(200, 210, 300).text).toContain('300');
    expect(blockMoved(200, 210, 300).text).toContain('210');
    expect(roomMade(204, 3).text).toContain('+3');
    expect(roomMade(204, -3).text).toContain('-3');
  });
});

describe('describeOnAirFilter', () => {
  it('says so plainly when nothing is restricted', () => {
    expect(describeOnAirFilter(EMPTY_ON_AIR_FILTER)).toContain('no filter');
  });

  it('names the text, the publication restriction and the range', () => {
    const filter: OnAirFilter = {
      text: ' desporto ',
      publication: 'published',
      range: 'curated',
    };
    const described = describeOnAirFilter(filter);
    expect(described).toContain('desporto');
    expect(described).toContain('published');
    expect(described).toContain('100–699');

    expect(noOnAirMatch(filter)).toContain('desporto');
  });

  it('names the playground range when that is what is restricted', () => {
    expect(
      describeOnAirFilter({ ...EMPTY_ON_AIR_FILTER, range: 'playground' }),
    ).toContain('700–999');
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

describe('confirmations', () => {
  const arbRequest: fc.Arbitrary<ConfirmRequest> = fc.record({
    action: fc.constantFrom('delete', 'unpublish'),
    pageNumber: arbPage,
    title: fc.string({ maxLength: 40 }),
  });

  it('names the action and the page number in the heading', () => {
    fc.assert(
      fc.property(arbRequest, (request) => {
        const heading = confirmHeading(request);
        expect(heading).toContain(String(request.pageNumber));
        expect(heading.toLowerCase()).toContain(request.action);
      }),
    );
  });

  it('states that the change cannot be undone', () => {
    fc.assert(
      fc.property(arbRequest, (request) => {
        expect(confirmBody(request)).toContain('cannot be undone');
      }),
    );
  });

  it('says what delete takes that unpublish does not', () => {
    const base = { pageNumber: 412, title: 'Desporto' };
    expect(confirmBody({ ...base, action: 'delete' })).toContain('directory role');
    expect(confirmBody({ ...base, action: 'unpublish' })).toContain(
      'publication record',
    );
  });

  it('names an untitled page rather than quoting an empty title', () => {
    const body = confirmBody({ action: 'delete', pageNumber: 412, title: '   ' });
    expect(body).toContain('untitled');
    expect(body).not.toContain('““');
  });

  it('labels the confirming control with the action it performs', () => {
    fc.assert(
      fc.property(arbRequest, (request) => {
        expect(confirmLabel(request).toLowerCase()).toContain(request.action);
      }),
    );
  });
});

describe('captureSelectionLost', () => {
  it('is a status, not an alert — nothing failed', () => {
    expect(captureSelectionLost().tone).toBe('status');
  });
});
