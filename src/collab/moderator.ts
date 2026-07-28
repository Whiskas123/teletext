/**
 * Moderator identity.
 *
 * There is no backend, so this cannot be real authentication — anyone reading
 * the shipped bundle can find the expected passcode, and nothing stops a
 * determined member from setting the flag by hand in devtools. It exists to
 * keep the archive protected from accidental edits, not hostile ones.
 *
 * The flag is stored in `localStorage` (unlike the session-scoped display
 * name in `session.ts`) because moderator status is meant to persist across
 * reloads on the moderator's own device, not just the current tab.
 */

const MODERATOR_FLAG_KEY = 'teletext:isModerator';

/** Fired on this flag changing so mounted components can react without a reload. */
const MODERATOR_EVENT = 'teletext:moderator-change';

/** In-memory fallback used when `localStorage` is unavailable. */
let inMemoryModerator = false;

/** Access `localStorage`, returning `undefined` when it is unavailable. */
function getStorage(): Storage | undefined {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the current device is recognized as the moderator. */
export function isModerator(): boolean {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(MODERATOR_FLAG_KEY) === 'true';
    } catch {
      // fall through to the in-memory fallback
    }
  }
  return inMemoryModerator;
}

function setModerator(value: boolean): void {
  inMemoryModerator = value;
  const storage = getStorage();
  if (storage) {
    try {
      if (value) storage.setItem(MODERATOR_FLAG_KEY, 'true');
      else storage.removeItem(MODERATOR_FLAG_KEY);
    } catch {
      // in-memory fallback already updated above
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MODERATOR_EVENT));
  }
}

/**
 * Check `passcode` against the build-time `VITE_MODERATOR_PASSCODE` and, on a
 * match, mark this device as the moderator. Returns whether it matched.
 *
 * When no passcode is configured for this build, this always fails closed —
 * there is no way to become the moderator, rather than an empty passcode
 * matching everything.
 */
export function trySetModerator(passcode: string): boolean {
  const expected = import.meta.env.VITE_MODERATOR_PASSCODE;
  if (!expected || passcode !== expected) return false;
  setModerator(true);
  return true;
}

/** Stop recognizing this device as the moderator. */
export function clearModerator(): void {
  setModerator(false);
}

export { MODERATOR_EVENT };
