// Every address has its own live pages but they all share one database. A
// mirror on a preview link or localhost would overwrite the real backup with
// another site's pages, so off the live address it must not send anything.

import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../domain/seo', () => ({ SITE_URL: 'https://teletext.example' }));
vi.mock('@playhtml/react', () => ({
  usePlayContext: () => ({ isLoading: false }),
  usePageData: () => [{ 100: { 0: { char: 'A', fg: 'white', bg: 'black' } } }, vi.fn()],
}));

const { LiveMirror, useMirrorStatus } = await import('./liveMirror');

afterEach(() => vi.unstubAllGlobals());

it('never reads or writes the shared copy from another address', async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  let phase = '';
  function Harness() {
    const current = useMirrorStatus().phase;
    useEffect(() => {
      phase = current;
    });
    return <LiveMirror />;
  }
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(phase).toBe('wrong-host');
  vi.useRealTimers();
});
