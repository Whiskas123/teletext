/**
 * Stable per-session member identity.
 *
 * All collaborative hooks (presence, chat, voting, editing cursors) must agree
 * on a single member id for the current browser session so that a member's
 * actions are consistently attributed. This module owns that identity and keeps
 * it framework-light (no React) so both hooks and pure helpers can share it.
 *
 * The id is generated once and persisted in `sessionStorage`, meaning it is
 * stable for the lifetime of the tab (survives in-app navigation and reloads)
 * but a fresh tab / session gets a distinct identity.
 */

const SESSION_MEMBER_ID_KEY = 'teletext:sessionMemberId';

/** Storage key for the member's chosen display name (set on the landing page). */
const DISPLAY_NAME_KEY = 'teletext:displayName';

/** In-memory fallback used when `sessionStorage` is unavailable. */
let inMemoryMemberId: string | null = null;

/** In-memory fallback for the display name when `sessionStorage` is unavailable. */
let inMemoryDisplayName: string | null = null;

/** Access `sessionStorage`, returning `undefined` when it is unavailable. */
function getStorage(): Storage | undefined {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Generate a random, reasonably unique id. Prefers `crypto.randomUUID` when
 * available and falls back to a timestamp + random suffix otherwise.
 */
function generateMemberId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `m-${Date.now().toString(36)}-${random}`;
}

/**
 * Return the stable member id for the current session, generating and
 * persisting one on first access.
 */
export function getSessionMemberId(): string {
  // Try sessionStorage first so the id is stable across reloads in the tab.
  try {
    const storage =
      typeof globalThis !== 'undefined' ? globalThis.sessionStorage : undefined;
    if (storage) {
      const existing = storage.getItem(SESSION_MEMBER_ID_KEY);
      if (existing) {
        return existing;
      }
      const created = generateMemberId();
      storage.setItem(SESSION_MEMBER_ID_KEY, created);
      return created;
    }
  } catch {
    // sessionStorage can throw (e.g. disabled/private mode); fall back below.
  }

  if (inMemoryMemberId === null) {
    inMemoryMemberId = generateMemberId();
  }
  return inMemoryMemberId;
}

/**
 * Return the member's chosen display name for this session, or `null` when none
 * has been set yet (e.g. the member has not passed through the landing page).
 */
export function getStoredDisplayName(): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(DISPLAY_NAME_KEY);
    } catch {
      // fall through to the in-memory fallback
    }
  }
  return inMemoryDisplayName;
}

/**
 * Persist the member's chosen display name for the session so it survives
 * navigation and reloads within the tab, and so every collaborative hook
 * (presence, chat, votes, cursors) attributes actions to that name.
 */
export function setStoredDisplayName(name: string): void {
  inMemoryDisplayName = name;
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(DISPLAY_NAME_KEY, name);
    } catch {
      // in-memory fallback already updated above
    }
  }
}
