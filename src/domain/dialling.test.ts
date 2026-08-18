/**
 * Tests for the dialling rules.
 *
 * These were behaviour of the front panel before they were a module, and two
 * screens now depend on them agreeing — the set's keypad and the exhibition
 * screen's keyboard. What is worth pinning down is the resolving press: three
 * digits go somewhere or nowhere, and either way the entry is spent.
 */

import { describe, expect, it } from 'vitest';

import {
  DIAL_LENGTH,
  dialReadout,
  isDialDigit,
  pressDigit,
} from './dialling';

/** Dial a whole number, one press at a time, and report the last outcome. */
function dial(number: string) {
  let digits = '';
  let last = pressDigit(digits, number[0]);
  digits = last.digits;
  for (const digit of number.slice(1)) {
    last = pressDigit(digits, digit);
    digits = last.digits;
  }
  return last;
}

describe('pressDigit', () => {
  it('collects the first two digits without going anywhere', () => {
    const first = pressDigit('', '2');
    expect(first).toEqual({ digits: '2', page: null, refused: false });

    const second = pressDigit(first.digits, '4');
    expect(second).toEqual({ digits: '24', page: null, refused: false });
  });

  it('goes to the page on the third digit and forgets the entry', () => {
    const outcome = dial('243');
    expect(outcome.page).toBe(243);
    expect(outcome.digits).toBe('');
    expect(outcome.refused).toBe(false);
  });

  it('refuses a number no page can have, rather than rounding it into range', () => {
    const outcome = dial('042');
    expect(outcome.page).toBeNull();
    expect(outcome.refused).toBe(true);
    // Spent either way: a refused entry does not leave `04` behind to be
    // completed by whatever is pressed next.
    expect(outcome.digits).toBe('');
  });

  it('takes both ends of the range', () => {
    expect(dial('100').page).toBe(100);
    expect(dial('999').page).toBe(999);
  });

  it('starts a fresh entry after one has resolved', () => {
    const resolved = dial('100');
    expect(pressDigit(resolved.digits, '3')).toEqual({
      digits: '3',
      page: null,
      refused: false,
    });
  });
});

describe('dialReadout', () => {
  it('shows a dash for each digit still to come', () => {
    expect(dialReadout('', false)).toBeNull();
    expect(dialReadout('2', false)).toBe('2--');
    expect(dialReadout('24', false)).toBe('24-');
  });

  it('says nothing while idle, so the page number can show instead', () => {
    expect(dialReadout('', false)).toBeNull();
  });

  it('shows the refusal over anything dialled underneath it', () => {
    expect(dialReadout('', true)).toBe('---');
    expect(dialReadout('7', true)).toBe('---');
    expect(dialReadout('', true)).toHaveLength(DIAL_LENGTH);
  });
});

describe('isDialDigit', () => {
  it('accepts the ten keys the keypad has and nothing else', () => {
    for (const digit of '0123456789') expect(isDialDigit(digit)).toBe(true);
    for (const key of ['Enter', 'ArrowUp', 'a', ' ', '', '12']) {
      expect(isDialDigit(key)).toBe(false);
    }
  });
});
