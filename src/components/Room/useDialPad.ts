/**
 * useDialPad — a page number being dialled, and the two timers that outlive it.
 *
 * The rules are in `domain/dialling.ts`; what is here is the part that cannot
 * be pure, which is that both of the set's responses are *timed*. A half
 * dialled number expires on its own after {@link DIAL_TIMEOUT_MS}, and a refusal
 * shows `---` for {@link DIAL_ERROR_MS} and then gets out of the way. Neither is
 * triggered by anything the viewer does, so neither can live in an event
 * handler.
 *
 * Shared by the front panel ({@link CrtTelevision}) and the exhibition screen
 * ({@link useExhibitMode}), which have nothing else in common: one is ten
 * plastic keys on an SVG, the other is a keyboard in a dark room. They dial
 * identically because this is the same object in both.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  DIAL_ERROR_MS,
  DIAL_TIMEOUT_MS,
  dialReadout,
  pressDigit,
} from '../../domain/dialling';

export interface DialPad {
  /**
   * The three characters to show in place of the page number — `2--`, `24-`,
   * `---` — or `null` when nothing is being dialled and the page number itself
   * should show.
   */
  readout: string | null;
  /** Press one of the ten digits. */
  press(digit: string): void;
  /**
   * Show the refusal reading now, for an entry refused by something other than
   * the dialling rules.
   *
   * A set on its own can only be refused by arithmetic — 0xx is not a page — and
   * `press` already handles that. In a room the set does not change the page, it
   * asks the room for one, and the room can say no for reasons the television has
   * no view on (a vote already running, say). This is how that answer gets into
   * the window without the caller having to know what `---` is.
   */
  refuse(): void;
  /** Forget a half-dialled number now: the set losing power, or the screen going away. */
  reset(): void;
}

/**
 * Hold one page entry in progress.
 *
 * @param onPageEntry Called with the page once three digits name a real one.
 *   Omit to collect digits that go nowhere — which is what an unpowered set,
 *   or a screen with no navigation of its own, should do.
 */
export function useDialPad(onPageEntry?: (pageNumber: number) => void): DialPad {
  const [digits, setDigits] = useState('');
  const [refused, setRefused] = useState(false);

  // A page half dialled and then abandoned should not sit on the display
  // waiting forever — nor should it still be there to be completed by a digit
  // pressed minutes later, which would go somewhere nobody asked for.
  useEffect(() => {
    if (digits === '') return;
    const timer = setTimeout(() => setDigits(''), DIAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [digits]);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(false), DIAL_ERROR_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  const press = useCallback(
    (digit: string) => {
      const outcome = pressDigit(digits, digit);
      setDigits(outcome.digits);
      if (outcome.refused) setRefused(true);
      if (outcome.page != null) onPageEntry?.(outcome.page);
    },
    [digits, onPageEntry],
  );

  // Whatever was half dialled goes with it: the number that was refused is the
  // one that was just asked for, and leaving two digits of it on the display
  // invites the third to be pressed against an answer that already came back no.
  const refuse = useCallback(() => {
    setDigits('');
    setRefused(true);
  }, []);

  const reset = useCallback(() => {
    setDigits('');
    setRefused(false);
  }, []);

  return { readout: dialReadout(digits, refused), press, refuse, reset };
}
