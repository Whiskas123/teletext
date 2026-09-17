/**
 * Tests for the build's switches.
 *
 * Two things here can break silently and neither shows up in review. The first
 * is the reading: a value typed into a hosting dashboard is a string, and only
 * a yes should turn a feature on — a flag that read an empty variable, or a
 * misspelt one, as consent would put MIX in front of visitors nobody meant to
 * ask.
 *
 * The second is the *name*. `MIX_ENABLED` is the only thing that knows the
 * variable is called `VITE_MIX`, and renaming it here would not break a single
 * type: the flag would simply be off for ever, and the deployment that had asked
 * for MIX would never get it. So the name is pinned by a test that sets the
 * variable and re-imports the module.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { flagOn, MIX_ENABLED } from './features';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('flagOn', () => {
  it('is off when nothing was set', () => {
    expect(flagOn(undefined)).toBe(false);
  });

  it('is off when the variable is set to nothing, which is how unset often arrives', () => {
    expect(flagOn('')).toBe(false);
    expect(flagOn('   ')).toBe(false);
  });

  it('reads an explicit yes as on, however the field was filled in', () => {
    for (const value of ['on', 'true', '1', 'yes', 'ON', 'True', '  on  ']) {
      expect(flagOn(value), value).toBe(true);
    }
  });

  it('reads everything else as off, typos included', () => {
    for (const value of ['off', 'false', '0', 'no', 'OFF', 'onn', 'enabled', 'maybe']) {
      expect(flagOn(value), value).toBe(false);
    }
  });
});

describe('MIX_ENABLED', () => {
  it('is off in a build that has not asked for MIX', () => {
    // The suite runs with no `VITE_MIX`, which is also what the deployment
    // builds with: the published site has no MIX key.
    expect(MIX_ENABLED).toBe(false);
  });

  it('is on when VITE_MIX says so, under that exact name', async () => {
    vi.stubEnv('VITE_MIX', 'on');
    vi.resetModules();

    const { MIX_ENABLED: rebuilt } = await import('./features');

    expect(rebuilt).toBe(true);
  });
});
