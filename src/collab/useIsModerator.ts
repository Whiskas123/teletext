/**
 * useIsModerator — reactive read of the moderator flag (`collab/moderator.ts`).
 *
 * Plain `localStorage` reads don't re-render anything on their own. This hook
 * re-checks the flag whenever it changes: `storage` events cover other tabs on
 * the same origin, and the module's own custom event covers this tab (the
 * `storage` event famously never fires in the tab that made the write).
 */

import { useEffect, useState } from 'react';
import { isModerator, MODERATOR_EVENT } from './moderator';

export function useIsModerator(): boolean {
  const [moderator, setModeratorFlag] = useState(isModerator);

  useEffect(() => {
    const handler = () => setModeratorFlag(isModerator());
    window.addEventListener(MODERATOR_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(MODERATOR_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  return moderator;
}
