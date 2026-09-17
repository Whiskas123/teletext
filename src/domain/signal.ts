/**
 * The television's other input: what MIX puts behind the text.
 *
 * Teletext was never a screen of its own. It was drawn *into* the picture that
 * was already there, and every character cell coded black as its background was
 * a hole the broadcast showed through — which is why a set had a MIX key at all,
 * and why holding a page over the news reads as teletext in a way a page on a
 * black rectangle never quite does. The archive has no broadcast behind it, so
 * the set is offered the one live picture a browser can actually give it: the
 * camera pointed at whoever is watching.
 *
 * What is here is the part of that with no browser in it — the states the input
 * can be in, and how to read the answer when asking for a camera goes wrong.
 * Getting the picture is {@link useCameraSignal}; showing it is
 * {@link CrtTelevision} and the `[data-mix]` rules in `App.css`.
 */

/**
 * The four things the set's second input can be doing.
 *
 * `tuning` is its own state rather than a flag beside `off`, because the browser
 * takes as long as the person does: the permission prompt is a dialogue with a
 * human in it, and a lamp that lit only once they answered would look for all
 * the world like a key that did nothing.
 */
export type SignalState = 'off' | 'tuning' | 'live' | 'refused' | 'no-signal';

/**
 * How long a refusal stays on the tube.
 *
 * Long enough to read the reason, short enough that the set does not sit there
 * insisting. Then it goes quiet and the black background comes back — the same
 * shape as `DIAL_ERROR_MS` in `domain/dialling.ts`, which is the other thing
 * this television says no with.
 */
export const SIGNAL_ERROR_MS = 4500;

/**
 * Which kind of no came back from `getUserMedia`.
 *
 * Only the distinction the viewer can act on is kept: *you said no* and *there
 * is nothing to show you*. A refusal is worth naming because it is reversible —
 * the browser will ask again, or the site permission can be changed — while a
 * missing, busy or unusable camera is not something pressing MIX again will fix.
 *
 * `SecurityError` counts as refused: it is what a browser raises when the page
 * is not allowed to ask at all (an insecure origin, or a permissions policy),
 * and from the viewer's side that is the same event as saying no.
 *
 * Anything unrecognised — including a plain `Error`, which is what a stubbed or
 * elderly implementation throws — is treated as no signal rather than as a
 * refusal, so the set never blames the viewer for a fault it cannot identify.
 */
const REFUSAL_NAMES: ReadonlySet<string> = new Set([
  'NotAllowedError',
  'SecurityError',
  // Both shipped before the names in the spec settled, and both are still out
  // there in browsers this archive is likely to be read on.
  'PermissionDeniedError',
  'PermissionDismissedError',
]);

export function signalFailure(error: unknown): 'refused' | 'no-signal' {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  return REFUSAL_NAMES.has(name) ? 'refused' : 'no-signal';
}

/** Whether the text should be holed through to show what is behind it. */
export function isMixing(state: SignalState): boolean {
  return state === 'live';
}

/** Whether the state is one the set should be reporting on the glass. */
export function isSignalFault(state: SignalState): boolean {
  return state === 'refused' || state === 'no-signal';
}
