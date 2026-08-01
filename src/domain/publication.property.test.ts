/**
 * Property tests for the publication rules.
 *
 * The invariant that matters most: nothing valid ever targets the playground.
 * Publishing into 700..999 would put curated archive content somewhere any
 * visitor may overwrite it, and it would be a quiet failure — the page would
 * look right until someone edited it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PLAYGROUND_MIN_PAGE } from './access';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  describeRejection,
  validatePublication,
  type PublicationRejection,
} from './publication';

const decoded = { exists: true, decoded: true };

describe('validatePublication', () => {
  it('never accepts a page in the playground range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PLAYGROUND_MIN_PAGE, max: 999 }),
        (pageNumber) => {
          const result = validatePublication(
            { pageNumber, captureId: 1 },
            decoded,
          );
          expect(result.ok).toBe(false);
        },
      ),
    );
  });

  it('accepts every page in the archive range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: PLAYGROUND_MIN_PAGE - 1 }),
        (pageNumber) => {
          const result = validatePublication(
            { pageNumber, captureId: 7 },
            decoded,
          );
          expect(result.ok).toBe(true);
        },
      ),
    );
  });

  it('rejects page numbers outside 1..999 entirely', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 99 }),
          fc.integer({ min: 1000, max: 5000 }),
          fc.double({ min: 100, max: 699, noInteger: true }),
        ),
        (pageNumber) => {
          expect(validatePublication({ pageNumber, captureId: 1 }, decoded).ok).toBe(
            false,
          );
        },
      ),
    );
  });

  it('refuses a capture that has not been decoded', () => {
    // The whole SIC corpus is in this state: catalogued and browsable, but with
    // no cells, so publishing it would put a blank page on air.
    const result = validatePublication(
      { pageNumber: 150, captureId: 1 },
      { exists: true, decoded: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('capture-not-decoded');
  });

  it('refuses a capture that is not there', () => {
    const result = validatePublication(
      { pageNumber: 150, captureId: 999999 },
      { exists: false, decoded: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('capture-missing');
  });

  it('refuses a non-positive or non-integer capture id', () => {
    for (const captureId of [0, -1, 1.5, 'abc', null, undefined]) {
      const result = validatePublication({ pageNumber: 150, captureId }, decoded);
      expect(result.ok).toBe(false);
    }
  });

  it('trims title and description', () => {
    const result = validatePublication(
      {
        pageNumber: 150,
        captureId: 1,
        title: '  Expo 98  ',
        description: '  A page about the world fair.  ',
      },
      decoded,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Expo 98');
      expect(result.value.description).toBe('A page about the world fair.');
    }
  });

  it('accepts text exactly at the limits and rejects one over', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_TITLE_LENGTH }), (length) => {
        const result = validatePublication(
          { pageNumber: 150, captureId: 1, title: 'a'.repeat(length) },
          decoded,
        );
        expect(result.ok).toBe(true);
      }),
    );

    expect(
      validatePublication(
        { pageNumber: 150, captureId: 1, title: 'a'.repeat(MAX_TITLE_LENGTH + 1) },
        decoded,
      ).ok,
    ).toBe(false);

    expect(
      validatePublication(
        {
          pageNumber: 150,
          captureId: 1,
          description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1),
        },
        decoded,
      ).ok,
    ).toBe(false);
  });

  it('treats missing title and description as empty rather than failing', () => {
    const result = validatePublication({ pageNumber: 150, captureId: 1 }, decoded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('');
      expect(result.value.description).toBe('');
    }
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.anything(),
        fc.anything(),
        fc.anything(),
        (pageNumber, captureId, title, description) => {
          expect(() =>
            validatePublication(
              { pageNumber, captureId, title, description },
              decoded,
            ),
          ).not.toThrow();
        },
      ),
    );
  });
});

describe('describeRejection', () => {
  it('has a message for every reason', () => {
    const reasons: PublicationRejection[] = [
      'page-out-of-range',
      'capture-missing',
      'capture-not-decoded',
      'title-too-long',
      'description-too-long',
    ];
    for (const reason of reasons) {
      expect(describeRejection(reason).length).toBeGreaterThan(0);
    }
  });
});
