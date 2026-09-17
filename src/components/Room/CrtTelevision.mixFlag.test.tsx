/**
 * The set as a build with MIX switched off draws it — which is every build that
 * has not set `VITE_MIX=on`, the published site included.
 *
 * Its own file rather than a case in `CrtTelevision.mix.test.tsx`, because the
 * flag is read when `features.ts` is first imported and is a constant from then
 * on: a build either has MIX or it does not, and a test file that changed its
 * mind halfway would be testing something no visitor can ever see. Mocking the
 * module rather than re-importing the component under a stubbed environment,
 * because re-importing would hand this file a second copy of React and every
 * hook in the set would break on it.
 *
 * What matters is that off means *absent*: no key on the panel, none on the
 * handset, and — the reason the flag exists — no route to a permission prompt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

import { COPY } from '../../domain/copy';
import CrtTelevision from './CrtTelevision';
import { useCameraSignal } from './useCameraSignal';

vi.mock('../../features', () => ({
  MIX_ENABLED: false,
  flagOn: () => false,
}));

const copy = COPY.pt.tv;

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
  });
});

describe('MIX switched off for the build', () => {
  it('leaves no MIX key on the front panel', () => {
    const { container } = render(
      <CrtTelevision pageNumber={100} subpage={1} subpageCount={1}>
        <div data-testid="picture" />
      </CrtTelevision>,
    );

    expect(screen.queryByRole('button', { name: copy.mixOn })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.mixOff })).not.toBeInTheDocument();
    expect(container.querySelector('#mix')).not.toBeInTheDocument();
    // The rest of the set is untouched: this is a television with one input,
    // not a broken one.
    expect(screen.getByRole('button', { name: copy.switchOff })).toBeInTheDocument();
    expect(container.querySelector('.crt-tv')).not.toHaveAttribute('data-mix');
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });

  it('leaves no MIX key on the handset, and keeps the row it sat in', () => {
    const { container } = render(
      <CrtTelevision pageNumber={100} subpage={1} subpageCount={1} compact>
        <div data-testid="picture" />
      </CrtTelevision>,
    );

    expect(screen.queryByRole('button', { name: copy.mixOn })).not.toBeInTheDocument();
    expect(container.querySelector('#rc-mix')).not.toBeInTheDocument();

    // The function row survives as the maker's name alone — which is what the
    // bottom edge of a remote with nothing to put there always was. Asked of
    // the row rather than of the document, because the cabinet carries the same
    // wordmark and the legend on the key is the thing that has to be gone.
    const row = container.querySelector('#remote-mix');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('TELETEXTRON');
    expect(row?.textContent).not.toContain('MIX');
  });

  it('never asks for a camera, even if something calls toggle', () => {
    const { result } = renderHook(() => useCameraSignal());

    act(() => result.current.toggle());

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.state).toBe('off');
    expect(result.current.stream).toBeNull();
  });
});
