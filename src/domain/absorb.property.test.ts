/**
 * Rules for folding one page into another's carousel.
 *
 * This empties the source page, so the refusals are the whole safety of the
 * operation — each one below is a way an operator could otherwise destroy a
 * page while believing they were adding a subpage.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { describeAbsorb, previewAbsorb, type AbsorbInput } from './absorb';
import { MAX_SUBPAGE } from './subpages';

const occupied = new Set([100, 117, 118, 119, 220, 500]);

function preview(over: Partial<AbsorbInput> = {}) {
  return previewAbsorb({
    target: 117,
    source: 118,
    targetCount: 1,
    sourceCount: 1,
    occupied,
    ...over,
  });
}

describe('previewAbsorb', () => {
  it('lands the source at the end of the target carousel', () => {
    // The case this exists for: NOTÍCIAS on 117, 118, 119 was one story split
    // across page numbers, and folding 118 in puts it back and frees a number.
    const result = preview({ targetCount: 2 });
    expect(result).toEqual({
      ok: true,
      target: 117,
      source: 118,
      moving: 1,
      firstSubpage: 3,
    });
  });

  it('moves the source’s whole carousel, not only its first screen', () => {
    const result = preview({ targetCount: 2, sourceCount: 3 });
    expect(result).toMatchObject({ ok: true, moving: 3, firstSubpage: 3 });
  });

  it('refuses a page as its own subpage', () => {
    expect(preview({ source: 117 })).toEqual({ ok: false, reason: 'same-page' });
  });

  it('refuses a source that holds nothing', () => {
    // Absorbing an empty page would spend a subpage slot on a blank screen and
    // report success.
    expect(preview({ source: 404 })).toEqual({ ok: false, reason: 'empty-source' });
  });

  it('refuses an empty or half-typed field rather than guessing', () => {
    expect(preview({ source: Number.NaN })).toEqual({ ok: false, reason: 'no-page' });
    expect(preview({ source: 7 })).toEqual({ ok: false, reason: 'no-page' });
  });

  it('refuses rather than absorbing only the part that fits', () => {
    // Half a story on each of two pages is worse than being told no.
    const result = preview({ targetCount: MAX_SUBPAGE - 1, sourceCount: 3 });
    expect(result).toEqual({ ok: false, reason: 'too-many' });
  });

  it('allows exactly filling the carousel', () => {
    const result = preview({ targetCount: MAX_SUBPAGE - 3, sourceCount: 3 });
    expect(result).toMatchObject({ ok: true, firstSubpage: MAX_SUBPAGE - 2 });
  });

  it('never plans past the cap, and never throws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 999 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 60 }),
        (source, targetCount, sourceCount) => {
          const result = previewAbsorb({
            target: 117,
            source,
            targetCount,
            sourceCount,
            occupied,
          });
          if (result.ok) {
            expect(result.firstSubpage + result.moving - 1).toBeLessThanOrEqual(
              MAX_SUBPAGE,
            );
            expect(result.source).not.toBe(result.target);
          }
        },
      ),
    );
  });
});

describe('describeAbsorb', () => {
  it('says the source is emptied, not just that the target grows', () => {
    // The half an operator forgets is the one that loses a page.
    const text = describeAbsorb(preview({ targetCount: 2 }));
    expect(text).toContain('118');
    expect(text).toContain('subpage 3');
    expect(text).toMatch(/left empty/i);
  });

  it('names the range when a whole carousel travels', () => {
    const text = describeAbsorb(preview({ targetCount: 1, sourceCount: 3 }));
    expect(text).toContain('subpages 2–4');
    expect(text).toContain('3 screens');
  });

  it('explains every refusal', () => {
    for (const result of [
      preview({ source: Number.NaN }),
      preview({ source: 117 }),
      preview({ source: 404 }),
      preview({ targetCount: MAX_SUBPAGE, sourceCount: 2 }),
    ]) {
      expect(describeAbsorb(result).length).toBeGreaterThan(10);
    }
  });
});
