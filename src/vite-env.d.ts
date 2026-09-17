/// <reference types="vite/client" />

/**
 * The client-side environment, named rather than left to the index signature
 * `vite/client` provides.
 *
 * Only build-time switches belong here. VITE_ values are inlined into the
 * bundle and readable by every visitor, so a secret must never become one —
 * see the note at the top of `.env.example`.
 */
interface ImportMetaEnv {
  /** `off` builds the site without MIX. See `MIX_ENABLED` in `features.ts`. */
  readonly VITE_MIX?: string;
}
