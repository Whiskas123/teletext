/**
 * Reload when a screen's code can no longer be fetched because a deploy
 * replaced it.
 *
 * Every screen past the front page is a lazy chunk with a hashed name
 * (`App.tsx`). A tab opened before a deploy still asks for the old names, and
 * those are gone: the catch-all rewrite in `vercel.json` answers with
 * `index.html`, the import fails, and with nothing to catch it React unmounts
 * the app — a black screen until the reader reloads. So reload for them. The
 * HTML is served `must-revalidate`, so the reload gets the new build, and the
 * address already names the screen they asked for.
 *
 * Once per {@link WINDOW_MS}: if the chunk is still missing after a reload, the
 * site is actually broken, and a reload loop would only hide that.
 */

const KEY = 'teletext.staleChunkReload';
const WINDOW_MS = 10_000;

/** Whether to reload now, given when this tab last reloaded for this reason. */
export function shouldReload(last: string | null, now: number): boolean {
  const then = Number(last);
  return !(then > 0 && now - then < WINDOW_MS);
}

export function reloadOnStaleChunk(): void {
  window.addEventListener('vite:preloadError', () => {
    try {
      if (!shouldReload(sessionStorage.getItem(KEY), Date.now())) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // No storage means no loop guard, so no automatic reload either.
      return;
    }
    window.location.reload();
  });
}
