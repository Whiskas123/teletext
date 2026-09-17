/**
 * useCameraSignal — the live picture MIX puts behind the teletext.
 *
 * The states and the reading of a refusal are in `domain/signal.ts`; what is
 * here is the part that cannot be pure, and all of it is about *letting go*.
 * A camera is not a value: while this hook holds one there is a lamp on
 * somebody's laptop, so every path that stops mixing — pressing MIX again,
 * switching the set off, leaving the screen, the camera being unplugged from
 * under us — has to end with the tracks stopped. A stream left running behind a
 * component that has gone is a light that will not turn off.
 *
 * ## Nothing leaves the browser
 *
 * The stream is attached to a `<video>` element and read by nothing else. There
 * is no canvas sampling it, no frame is uploaded, and no page in the archive can
 * see it: the picture exists for exactly as long as the element is on screen and
 * is never in the room's shared state. Mix mode is a lamp and a `srcObject`.
 *
 * ## The generation counter
 *
 * `getUserMedia` resolves whenever the person answers the prompt, which may be
 * long after they gave up and pressed MIX again — or after the set was switched
 * off, or after the screen was left. An answer that arrives for a question
 * nobody is asking any more must not turn a camera on, so every request carries
 * the generation it was made in and a stale one stops the stream it was handed
 * instead of keeping it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SIGNAL_ERROR_MS,
  signalFailure,
  type SignalState,
} from '../../domain/signal';
import { MIX_ENABLED } from '../../features';

export interface CameraSignal {
  /** What the input is doing; drives the lamp and the caption on the glass. */
  state: SignalState;
  /** The picture, or null when there isn't one. */
  stream: MediaStream | null;
  /** Ask for the camera, or give it back if we already have it. */
  toggle(): void;
  /** Give it back now: the set losing power, or the screen going away. */
  stop(): void;
}

/** Turn off whatever lamp this stream lit. Safe on a stream already stopped. */
function release(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * The camera the set is mixing with, and the promise that it is only on while
 * the set says it is.
 */
export function useCameraSignal(): CameraSignal {
  const [state, setState] = useState<SignalState>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);

  /*
   * The stream as a ref as well as state, because the two readers want
   * different things: the `<video>` wants to re-render when it changes, and
   * unmount cleanup wants whatever is running *now* without having to re-run
   * every time it changes. A cleanup that depended on the stream would tear
   * down and rebuild on each swap, which is exactly when a camera must not
   * flicker.
   */
  const held = useRef<MediaStream | null>(null);
  const generation = useRef(0);

  const stop = useCallback(() => {
    // Bumped even when nothing is running: it is what makes a request still in
    // flight — a prompt sitting unanswered on the screen — come back to nothing.
    generation.current += 1;
    release(held.current);
    held.current = null;
    setStream(null);
    setState('off');
  }, []);

  // The screen going away is the one release path with no press behind it.
  useEffect(
    () => () => {
      generation.current += 1;
      release(held.current);
      held.current = null;
    },
    [],
  );

  // A fault is said once and then dropped, so the set goes quiet on its own
  // rather than sitting there with a complaint on the tube.
  useEffect(() => {
    if (state !== 'refused' && state !== 'no-signal') return;
    const timer = setTimeout(() => setState('off'), SIGNAL_ERROR_MS);
    return () => clearTimeout(timer);
  }, [state]);

  /*
   * The camera going away without being asked: unplugged, taken by another
   * application, or the permission revoked in the browser's own UI. The track
   * ends and the picture freezes on its last frame, which would leave the set
   * showing a still it claims is live. Treated as switching MIX off, because
   * that is what has happened.
   */
  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (track == null) return;
    const ended = () => stop();
    track.addEventListener('ended', ended);
    return () => track.removeEventListener('ended', ended);
  }, [stream, stop]);

  const tune = useCallback(async () => {
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia == null) {
      // No camera API at all: an insecure origin, or a browser without one.
      setState('no-signal');
      return;
    }

    generation.current += 1;
    const asked = generation.current;
    setState('tuning');

    try {
      // The tube is 4:3 and the picture is cropped to fill it, so the shape is
      // asked for rather than demanded — `ideal`, so a camera that cannot give
      // it hands over what it has instead of refusing outright.
      const next = await devices.getUserMedia({
        video: { facingMode: 'user', aspectRatio: { ideal: 4 / 3 } },
        audio: false,
      });
      if (asked !== generation.current) {
        release(next);
        return;
      }
      held.current = next;
      setStream(next);
      setState('live');
    } catch (error) {
      if (asked !== generation.current) return;
      setState(signalFailure(error));
    }
  }, []);

  const toggle = useCallback(() => {
    /*
     * A build without MIX has no second input to ask for.
     *
     * Said here as well as at the key, because this is the one function in the
     * codebase that can put a browser permission prompt in front of somebody:
     * it should be *unable* to, on a build that has switched MIX off, rather
     * than merely left unwired by the component that normally calls it. See
     * `MIX_ENABLED` in `features.ts`.
     */
    if (!MIX_ENABLED) return;

    // A fault reading counts as off: pressing MIX while it is up is somebody
    // asking again, which for a refusal is exactly the right thing to do.
    if (state === 'live' || state === 'tuning') stop();
    else void tune();
  }, [state, stop, tune]);

  return { state, stream, toggle, stop };
}

export default useCameraSignal;
