/**
 * Tests for reading the answer when a camera is asked for and does not come.
 *
 * The distinction is the only thing the set says out loud about a failure —
 * *you said no* against *there is nothing to show you* — and it is drawn from an
 * error's `name`, which is a string handed over by whichever browser is running.
 * So the cases worth pinning are the ones nobody can check by reading the code:
 * the legacy names, and everything unrecognised landing on the answer that does
 * not blame the viewer.
 */

import { describe, expect, it } from 'vitest';

import { isMixing, isSignalFault, signalFailure, type SignalState } from './signal';

describe('signalFailure', () => {
  it('reads a permission refusal as refused', () => {
    expect(signalFailure(new DOMException('denied', 'NotAllowedError'))).toBe('refused');
  });

  it('reads a blocked origin as refused, because from the viewer it is the same no', () => {
    expect(signalFailure(new DOMException('insecure', 'SecurityError'))).toBe('refused');
  });

  it('still recognises the names browsers shipped before the spec settled', () => {
    for (const name of ['PermissionDeniedError', 'PermissionDismissedError']) {
      expect(signalFailure({ name })).toBe('refused');
    }
  });

  it('reads a missing or unusable camera as no signal', () => {
    for (const name of ['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError']) {
      expect(signalFailure(new DOMException(name, name))).toBe('no-signal');
    }
  });

  it('blames nobody for a failure it cannot identify', () => {
    expect(signalFailure(new Error('boom'))).toBe('no-signal');
    expect(signalFailure('boom')).toBe('no-signal');
    expect(signalFailure(null)).toBe('no-signal');
    expect(signalFailure(undefined)).toBe('no-signal');
  });
});

describe('isMixing', () => {
  it('holes the page through only while a picture is actually arriving', () => {
    const states: SignalState[] = ['off', 'tuning', 'refused', 'no-signal'];
    expect(isMixing('live')).toBe(true);
    for (const state of states) expect(isMixing(state)).toBe(false);
  });
});

describe('isSignalFault', () => {
  it('is the two states the set has something to say about', () => {
    expect(isSignalFault('refused')).toBe(true);
    expect(isSignalFault('no-signal')).toBe(true);
    for (const state of ['off', 'tuning', 'live'] as SignalState[]) {
      expect(isSignalFault(state)).toBe(false);
    }
  });
});
