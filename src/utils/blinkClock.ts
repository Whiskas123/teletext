/**
 * The blink clock: one phase, shared by every blinking cell on the screen.
 *
 * Blinking is a property of the *page*, not of each cell that does it. A
 * teletext set had one clock and every blinking cell on the screen obeyed it,
 * so a blinking word was a word, not six letters flickering against each other.
 *
 * A CSS animation per cell cannot do that. An animation starts when the element
 * gets it, so a cell that is painted blink at 3s runs a second out of phase with
 * one painted at 2.5s, and stays that way — which is exactly what a brush that
 * paints blink a cell at a time produces. There is no way to phase-align them
 * from CSS: `animation-delay` would have to differ per cell, by an amount that
 * depends on when that cell happened to start.
 *
 * So the phase is kept here instead, in one place, and published as a single
 * class on the document element. Every blinking cell reads it through one CSS
 * rule, which means:
 *
 * - they are in phase by construction, whenever they were painted, and a cell
 *   that starts blinking joins the cycle already in step with the rest;
 * - the whole app costs one class toggle a second, no matter how many grids or
 *   cells are on screen. The invalidation is scoped by the selector to cells
 *   that actually blink, so a page with none does no style work at all;
 * - React is not involved. This is a fact about the wall clock, not about any
 *   component's state, and rendering it through React would put a re-render of
 *   every grid on screen twice a second — which is what the per-cell animation
 *   was introduced to get rid of in the first place.
 *
 * The phase is *derived* from the time rather than counted, so it cannot drift,
 * and a tab that was backgrounded — where timers are throttled to seconds or
 * stopped altogether — comes back in step instead of resuming wherever it was.
 */

/** A full cycle: on for half of it, off for the other half. */
export const BLINK_PERIOD_MS = 2000;

/**
 * Set on `<html>` for the half of the cycle blinking cells are hidden for.
 * Named for the *off* half so the default — no class, nothing hidden — is what
 * a document without the clock running shows.
 */
export const BLINK_OFF_CLASS = 'teletext-blink-off';

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Which half of the cycle the wall clock is in. */
function isOffPhase(now: number): boolean {
  return Math.floor(now / (BLINK_PERIOD_MS / 2)) % 2 === 1;
}

function publishPhase(): void {
  document.documentElement.classList.toggle(BLINK_OFF_CLASS, isOffPhase(Date.now()));
}

/**
 * Start the clock, and stop it when the returned function is called.
 *
 * Reference-counted, so any number of grids share the one timer and the last
 * one to go takes it with it — a screen with no teletext on it does no work.
 */
export function startBlinkClock(): () => void {
  subscribers += 1;
  if (timer == null) {
    publishPhase();
    timer = setInterval(publishPhase, BLINK_PERIOD_MS / 2);
  }

  let stopped = false;
  return () => {
    // Guarded: React runs an effect's cleanup once, but a caller that stops
    // twice must not take the clock away from everybody else.
    if (stopped) return;
    stopped = true;
    subscribers -= 1;
    if (subscribers > 0 || timer == null) return;
    clearInterval(timer);
    timer = null;
    document.documentElement.classList.remove(BLINK_OFF_CLASS);
  };
}
