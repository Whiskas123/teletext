/**
 * Tests for MIX: the black background holed through to a live picture.
 *
 * Three things are worth holding down here, and they are all about the camera
 * rather than about the pixels. The set has to ask for one when the key is
 * pressed; it has to *give it back* on every path that ends the mix — pressing
 * again, and switching the television off — because a stream left running is a
 * lamp on somebody's laptop that nothing will turn off; and a refusal has to be
 * said on the tube rather than swallowed.
 *
 * The rendering itself is one CSS rule keyed off `data-mix` (see `App.css`), so
 * what these assert on the page side is that attribute and the `<video>` behind
 * it — jsdom has no cascade to ask about the cells themselves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { COPY } from '../../domain/copy';
import CrtTelevision from './CrtTelevision';

/*
 * A build without `VITE_MIX=on` has no MIX key at all — that is the published
 * site, and `CrtTelevision.mixFlag.test.tsx` is what holds it. Everything below
 * is about the key working, so this file asks for the build that has one.
 */
vi.mock('../../features', () => ({
  MIX_ENABLED: true,
  flagOn: () => true,
}));

const copy = COPY.pt.tv;

/** A camera track that records having been stopped, which is the whole point. */
function fakeStream() {
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

const getUserMedia = vi.fn();

function renderSet() {
  return render(
    <CrtTelevision pageNumber={100} subpage={1} subpageCount={1}>
      <div data-testid="picture" />
    </CrtTelevision>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  // jsdom has no media pipeline: `play()` raises through the virtual console.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: vi.fn(() => Promise.resolve()),
    configurable: true,
  });
  /*
   * Reduced motion, so switching the set off lands on `off` immediately instead
   * of 900ms into a collapse animation. The test is about what happens to the
   * camera when the tube goes dark, not about how long it takes to get there.
   */
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

afterEach(() => {
  getUserMedia.mockReset();
});

describe('MIX', () => {
  it('asks for the camera and holes the page through to it', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { container } = renderSet();
    expect(container.querySelector('.crt-tv')).not.toHaveAttribute('data-mix');

    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));

    await waitFor(() =>
      expect(container.querySelector('.crt-tv')).toHaveAttribute('data-mix'),
    );
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Never the microphone: this is a picture behind a page, not a call.
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
  });

  it('gives the camera back when MIX is pressed again', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { container } = renderSet();
    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));
    await screen.findByRole('button', { name: copy.mixOff });

    fireEvent.click(screen.getByRole('button', { name: copy.mixOff }));

    expect(track.stop).toHaveBeenCalled();
    expect(container.querySelector('.crt-tv')).not.toHaveAttribute('data-mix');
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });

  it('gives the camera back when the television is switched off', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { container } = renderSet();
    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));
    await screen.findByRole('button', { name: copy.mixOff });

    fireEvent.click(screen.getByRole('button', { name: copy.switchOff }));

    await waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(container.querySelector('.crt-tv')).not.toHaveAttribute('data-mix');
  });

  it('releases the camera when the screen goes away', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { unmount } = renderSet();
    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));
    await screen.findByRole('button', { name: copy.mixOff });

    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it('says why on the tube when the camera is refused, and mixes nothing', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));

    const { container } = renderSet();
    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));

    expect(await screen.findByText(copy.noSignal)).toBeInTheDocument();
    expect(screen.getByText(copy.cameraRefused)).toBeInTheDocument();
    expect(container.querySelector('.crt-tv')).not.toHaveAttribute('data-mix');
  });

  it('says no signal when there is no camera API to ask', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });

    renderSet();
    fireEvent.click(screen.getByRole('button', { name: copy.mixOn }));

    expect(await screen.findByText(copy.cameraMissing)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('leaves MIX inert while the set is switched off', () => {
    renderSet();

    fireEvent.click(screen.getByRole('button', { name: copy.switchOff }));

    expect(screen.queryByRole('button', { name: copy.mixOn })).not.toBeInTheDocument();
  });
});
