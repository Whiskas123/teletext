/**
 * Tests for the shared blink phase.
 *
 * The point of the clock is that there is only one of it, so these are mostly
 * about sharing: two grids must not each get their own phase, the last one to
 * leave must clean up after everybody, and the phase must come from the wall
 * clock rather than from a count of ticks — a cell that starts blinking has to
 * join the cycle already in step, and a backgrounded tab whose timer was
 * throttled has to come back in step rather than resume where it left off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLINK_OFF_CLASS, BLINK_PERIOD_MS, startBlinkClock } from './blinkClock';

const HALF = BLINK_PERIOD_MS / 2;

/**
 * A time on an exact cycle boundary, so the run starts in the lit half.
 * `2_000_000 / 1_000` is even, which is what {@link isOffPhase} keys off.
 */
const CYCLE_START = BLINK_PERIOD_MS * 1000;

/** Whether blinking cells are currently hidden. */
function isOff(): boolean {
  return document.documentElement.classList.contains(BLINK_OFF_CLASS);
}

/** Every clock started by a test, stopped afterwards however the test ended. */
let running: (() => void)[] = [];

function start(): () => void {
  const stop = startBlinkClock();
  running.push(stop);
  return stop;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(CYCLE_START);
});

afterEach(() => {
  // A failed assertion must not leave the module-level clock running, or every
  // test after it would inherit a phase it did not set.
  for (const stop of running) stop();
  running = [];
  vi.useRealTimers();
  document.documentElement.classList.remove(BLINK_OFF_CLASS);
});

describe('startBlinkClock', () => {
  it('publishes the phase immediately rather than after the first tick', () => {
    // A grid mounting into the off half must not show a second of wrongly lit
    // cells before the clock catches up with it.
    vi.setSystemTime(CYCLE_START + HALF);
    start();

    expect(isOff()).toBe(true);
  });

  it('turns cells off for the second half of the cycle and on again after it', () => {
    start();
    expect(isOff()).toBe(false);

    vi.advanceTimersByTime(HALF);
    expect(isOff()).toBe(true);

    vi.advanceTimersByTime(HALF);
    expect(isOff()).toBe(false);
  });

  it('takes the phase from the clock, so a throttled tab comes back in step', () => {
    // The tab was hidden and the timer did not run for ten whole cycles. When
    // it fires again the phase is whatever the wall clock says, not one step on
    // from where it stopped.
    start();
    expect(isOff()).toBe(false);

    // Jump the wall clock, then let the timer fire once. It lands half a cycle
    // past a boundary, so the phase it publishes is the off half — the one the
    // clock says, not the one a tick count would have given.
    vi.setSystemTime(CYCLE_START + BLINK_PERIOD_MS * 10);
    vi.advanceTimersByTime(HALF);
    expect(isOff()).toBe(true);
  });

  it('shares one timer between grids, and keeps running while any remain', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    const first = start();
    start();
    expect(setInterval).toHaveBeenCalledTimes(1);

    // The first grid goes; the second is still watching, so the clock stays.
    first();
    vi.advanceTimersByTime(HALF);
    expect(isOff()).toBe(true);

    setInterval.mockRestore();
  });

  it('stops and clears the class once the last grid goes', () => {
    vi.setSystemTime(CYCLE_START + HALF);
    const stop = start();
    expect(isOff()).toBe(true);

    stop();
    // Nothing left to blink, so nothing left hidden — a stale off-phase class
    // would black out any cell that happened to carry it later.
    expect(isOff()).toBe(false);

    vi.advanceTimersByTime(BLINK_PERIOD_MS * 4);
    expect(isOff()).toBe(false);
  });

  it('survives a stop being called twice', () => {
    const first = start();
    start();

    first();
    first();

    // The second grid is still there, so the clock must be too.
    vi.advanceTimersByTime(HALF);
    expect(isOff()).toBe(true);
  });
});
