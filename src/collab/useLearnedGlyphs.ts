/**
 * useLearnedGlyphs — the atlas of characters taught on the import screen.
 *
 * These were kept in `localStorage` under `teletext.import.learnedGlyphs`, which
 * meant a character taught on one machine did not exist on any other, and was
 * one cleared browser profile away from being gone. They are knowledge about the
 * corpus, not browser state, so they now live in the database.
 *
 * `localStorage` is kept as a cache in front of it, for two reasons: a taught
 * character keeps working immediately and offline, and the import screen can
 * decode without waiting on a round trip. The server is the source of truth and
 * wins on conflict; the cache is only ever a head start.
 */

import { useCallback, useEffect, useState } from 'react';

/** Where the local cache lives. Unchanged, so nothing taught is orphaned. */
const CACHE_KEY = 'teletext.import.learnedGlyphs';

/** An atlas key is a stencil; anything else has no business reaching a decoder. */
const KEY_PATTERN = /^[0-9a-f]{16,80}$/;

/** Drop anything that is not a stencil-to-character pair. */
function sanitize(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([key, value]) =>
        KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0,
    ),
  ) as Record<string, string>;
}

function readCache(): Record<string, string> {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored == null ? {} : sanitize(JSON.parse(stored));
  } catch {
    return {};
  }
}

function writeCache(glyphs: Record<string, string>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(glyphs));
  } catch {
    // Private browsing, or a full quota. The atlas still works for this
    // session and the server copy is unaffected; not worth interrupting for.
  }
}

export interface LearnedGlyphsApi {
  /** Every taught character, server and cache merged. */
  glyphs: Record<string, string>;
  /** Teach one character, updating the cache now and the server behind it. */
  teach(key: string, character: string): void;
  /** Whether the last attempt to save to the server failed. */
  syncError: string | null;
  /** Whether the shared atlas has been fetched yet. */
  loading: boolean;
}

export function useLearnedGlyphs(): LearnedGlyphsApi {
  const [glyphs, setGlyphs] = useState<Record<string, string>>(readCache);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Pull the shared atlas once, then let it win over the local cache: another
  // machine may have taught characters this one has never seen.
  useEffect(() => {
    let cancelled = false;

    fetch('/api/glyphs', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((body: unknown) => {
        if (cancelled) return;
        const shared = sanitize((body as { glyphs?: unknown }).glyphs);
        setGlyphs((local) => {
          const merged = { ...local, ...shared };
          writeCache(merged);
          return merged;
        });
        setLoading(false);
      })
      .catch(() => {
        // No API, or offline. The cache alone is a working atlas.
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const teach = useCallback((key: string, character: string) => {
    if (!KEY_PATTERN.test(key) || character.length === 0) return;

    // Apply locally first: teaching should take effect on the next render, not
    // after a round trip.
    setGlyphs((previous) => {
      const next = { ...previous, [key]: character };
      writeCache(next);
      return next;
    });

    void fetch('/api/glyphs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ glyphs: { [key]: character } }),
    })
      .then((response) => {
        setSyncError(
          response.ok
            ? null
            : response.status === 401
              ? 'Sign in as moderator to share taught characters.'
              : `Could not save to the shared atlas (${response.status}).`,
        );
      })
      .catch(() => {
        setSyncError('Could not reach the server; taught locally only.');
      });
  }, []);

  return { glyphs, teach, syncError, loading };
}
