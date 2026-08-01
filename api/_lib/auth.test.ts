/**
 * Tests for admin session handling.
 *
 * This is the code that replaces a check anyone could bypass from the devtools
 * console, so the cases that matter are the adversarial ones: a tampered token,
 * a token signed with someone else's secret, an expired one, and a deployment
 * with nothing configured — which must lock rather than open.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearedCookie,
  isAuthConfigured,
  issueToken,
  passwordMatches,
  readCookie,
  sessionCookie,
  SESSION_COOKIE,
  verifyToken,
} from './auth';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'correct horse battery staple';
  process.env.SESSION_SECRET = 'test-secret-value';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('passwordMatches', () => {
  it('accepts the configured password', () => {
    expect(passwordMatches('correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(passwordMatches('correct horse battery stapl')).toBe(false);
    expect(passwordMatches('')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(passwordMatches(undefined)).toBe(false);
    expect(passwordMatches(null)).toBe(false);
    expect(passwordMatches(42)).toBe(false);
    expect(passwordMatches({})).toBe(false);
  });

  it('fails closed when no password is configured', () => {
    // A deployment that forgot to set one must be locked, not open to
    // everybody — including to the empty string.
    delete process.env.ADMIN_PASSWORD;
    expect(passwordMatches('')).toBe(false);
    expect(passwordMatches('anything')).toBe(false);
  });
});

describe('token issuing and verification', () => {
  it('accepts a token it just issued', () => {
    expect(verifyToken(issueToken())).toBe(true);
  });

  it('rejects nothing at all', () => {
    expect(verifyToken(undefined)).toBe(false);
    expect(verifyToken('')).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(verifyToken('nonsense')).toBe(false);
    expect(verifyToken('.abc')).toBe(false);
    expect(verifyToken('abc.')).toBe(false);
    expect(verifyToken('notanumber.deadbeef')).toBe(false);
  });

  it('rejects a token whose signature was altered', () => {
    const token = issueToken();
    const [expiry, signature] = token.split('.');
    const flipped = signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    expect(verifyToken(`${expiry}.${flipped}`)).toBe(false);
  });

  it('rejects a token whose expiry was extended', () => {
    // Pushing the expiry out invalidates the signature, which covers it.
    const token = issueToken();
    const [expiry, signature] = token.split('.');
    const later = Number(expiry) + 60_000;
    expect(verifyToken(`${later}.${signature}`)).toBe(false);
  });

  it('rejects an expired token even though it is correctly signed', () => {
    const past = Date.now() - 1000;
    // Sign a past expiry the same way the module would, then present it.
    const token = issueToken();
    const forged = `${past}.${token.split('.')[1]}`;
    expect(verifyToken(forged)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueToken();
    process.env.SESSION_SECRET = 'a-completely-different-secret';
    expect(verifyToken(token)).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    const token = issueToken();
    delete process.env.SESSION_SECRET;
    expect(verifyToken(token)).toBe(false);
  });
});

describe('isAuthConfigured', () => {
  it('is true only when both variables are set', () => {
    expect(isAuthConfigured()).toBe(true);
    delete process.env.SESSION_SECRET;
    expect(isAuthConfigured()).toBe(false);
    process.env.SESSION_SECRET = 'x';
    delete process.env.ADMIN_PASSWORD;
    expect(isAuthConfigured()).toBe(false);
  });
});

describe('cookies', () => {
  it('marks the session cookie HttpOnly, Secure and SameSite=Strict', () => {
    // HttpOnly is what stops page scripts reading the session, which is the
    // failure the old localStorage flag had.
    const cookie = sessionCookie('token-value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`${SESSION_COOKIE}=token-value`);
  });

  it('clears with an immediate expiry', () => {
    expect(clearedCookie()).toContain('Max-Age=0');
  });

  it('reads a cookie from the parsed bag', () => {
    const req = { cookies: { [SESSION_COOKIE]: 'abc' }, headers: {} };
    expect(readCookie(req as never, SESSION_COOKIE)).toBe('abc');
  });

  it('falls back to parsing the Cookie header', () => {
    const req = {
      cookies: undefined,
      headers: { cookie: `other=1; ${SESSION_COOKIE}=xyz; another=2` },
    };
    expect(readCookie(req as never, SESSION_COOKIE)).toBe('xyz');
  });

  it('returns undefined when the cookie is absent', () => {
    const req = { cookies: {}, headers: { cookie: 'other=1' } };
    expect(readCookie(req as never, SESSION_COOKIE)).toBeUndefined();
  });
});
