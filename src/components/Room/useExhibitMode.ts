/**
 * useExhibitMode — the archive shown on a television in a room, not in a browser.
 *
 * The set, the cabinet, the header, the back link, the little green connection
 * light: all of it says *website*, and on a real CRT standing in an exhibition
 * every one of those is a mistake. What should be on the glass is the page, at
 * the size of the glass, and nothing else. This hook is the mechanism for that;
 * {@link ExhibitScreen} is what it looks like.
 *
 * ## Nothing advertises it
 *
 * There is no button, because a button is one more thing on screen and one more
 * thing a visitor can press by accident. Two ways in, both for whoever is
 * setting the room up:
 *
 * - `?exhibit=1` on the watching URL, so the machine can be pointed at
 *   `/watch/243?exhibit=1` in a startup script and left alone.
 * - Shift+F from a normal watching session, which is also how you get back out
 *   again if you came in that way.
 *
 * Escape leaves, whichever way you came in, and lands back on the page that was
 * being shown.
 *
 * ## Fullscreen, and Safari
 *
 * True fullscreen is asked for whenever the screen goes up, because a browser
 * chrome bar across the top of a CRT in a gallery is exactly the thing this
 * mode exists to remove. It is not always granted, and the interesting refusal
 * is the one that is *correct*: `requestFullscreen()` only works from a user
 * gesture, and the URL parameter is by definition not one — nobody clicked
 * anything, the page simply loaded that way. Safari refuses it, and refuses it
 * in its own dialect: WebKit's prefixed `webkitRequestFullscreen` returns
 * `undefined` rather than a promise, and reports failure by throwing
 * synchronously or by firing `webkitfullscreenerror` at the document — so
 * `.catch()` on the return value catches nothing at all, and the request has to
 * be wrapped in both a `try` and a `Promise.resolve` to have somewhere for
 * either kind of failure to land.
 *
 * (Safari has had the unprefixed names since 16.4. The prefixed ones are kept
 * because the machine at the far end of an HDMI cable in a gallery is not
 * necessarily the machine anyone tested on, and the fallback costs four lines.)
 *
 * So a refusal is not an error condition here — it is the ordinary path for the
 * URL parameter. The screen is a `position: fixed` overlay over the whole
 * viewport either way, which already looks right; fullscreen only takes the
 * browser's own furniture away on top of that. The request is therefore retried
 * on the first gesture of any kind — a click, a keypress, plugging in a
 * keyboard and pressing a digit to dial a page — and the first one that lands
 * gets true fullscreen with nothing having been said to anybody about it.
 *
 * ## Keeping the picture on
 *
 * There is no pointer moving in front of an exhibition screen for hours at a
 * time, so the display sleeps and the CRT goes to a black rectangle in the
 * middle of the show. The Screen Wake Lock API prevents it in one call, is
 * feature-detected, and is allowed to fail silently: it is a nicety, not a
 * requirement, and a browser that refuses it should still show the page.
 *
 * ## Adopting it elsewhere
 *
 * Nothing here knows what a solo view is. A room can call this with its own
 * navigation callbacks and render {@link ExhibitScreen} around its own grid;
 * see {@link SoloViewer} for the whole of the wiring, which is two calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isDialDigit } from '../../domain/dialling';
import { useDialPad } from './useDialPad';

/** The query parameter that opens a watching screen straight into exhibition mode. */
export const EXHIBIT_PARAM = 'exhibit';

/** The chord that toggles it, with no `Ctrl`/`Cmd`/`Alt` alongside. */
const TOGGLE_KEY = 'f';

/** How long the pointer must sit still before it is taken off the picture. */
const CURSOR_IDLE_MS = 3000;

/** Set while the screen is up, so the page behind cannot scroll under it. */
const LOCK_CLASS = 'exhibit-lock';

/** For a rejected promise nobody is going to look at. */
const ignore = () => undefined;

/* ── the two dialects of the Fullscreen API ────────────────────────────────── */

/**
 * Both spellings, both optional.
 *
 * Declared here rather than reached for through the DOM types because those
 * have the unprefixed names as *required* members, which makes the `??` chain
 * onto the prefixed ones unreachable as far as the compiler is concerned — and
 * it is not unreachable, it is the whole point.
 */
interface FullscreenElement {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void> | undefined;
  webkitRequestFullscreen?: () => Promise<void> | undefined;
}

interface FullscreenDocument {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | undefined;
  webkitExitFullscreen?: () => Promise<void> | undefined;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
}

function fullscreenDocument(): FullscreenDocument {
  return document as unknown as FullscreenDocument;
}

/** Whether anything at all is fullscreen right now. */
function isFullscreen(): boolean {
  const doc = fullscreenDocument();
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) != null;
}

/**
 * Ask for fullscreen, in whichever dialect is available, and resolve or reject
 * once — however the browser chose to say no.
 */
function requestFullscreen(element: HTMLElement): Promise<void> {
  const target = element as unknown as FullscreenElement;
  const request =
    target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
  if (request == null) return Promise.reject(new Error('no Fullscreen API'));

  try {
    // `Promise.resolve` of `undefined` — WebKit's prefixed return value — is a
    // promise that resolves immediately, which is a lie about a request that
    // may yet fail. The `fullscreenchange` listener is what actually decides
    // whether we got it; this is only here to catch the synchronous refusal.
    return Promise.resolve(request()).then(ignore);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Leave fullscreen if we are in it, and say nothing if the browser objects. */
function exitFullscreen(): void {
  if (!isFullscreen()) return;
  const doc = fullscreenDocument();
  const leave = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
  try {
    void Promise.resolve(leave?.()).catch(ignore);
  } catch {
    /* Already out, or never in. Either way there is nothing to do. */
  }
}

/* ── the hook ──────────────────────────────────────────────────────────────── */

/** Whether a value of the URL parameter means "yes". */
function isExhibitParam(value: string | null): boolean {
  return value != null && value !== '0' && value !== 'false';
}

/**
 * Whether a key event came from somewhere that wants the key for itself.
 *
 * The watching screen has a search field in the directory leaflet, and typing
 * `f` into it must not black out the room.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * What the screen can do once it is the only thing on the display.
 *
 * All optional: a screen that supplies none of them shows a page and nothing
 * else, which is a legitimate exhibit.
 */
export interface ExhibitControls {
  /** Dial a page — called once three digits name a real one. */
  onPageEntry?: (pageNumber: number) => void;
  /** Step to the next/previous non-empty page. */
  onPageStep?: (delta: 1 | -1) => void;
  /** Step through the page's carousel of screens. */
  onSubpageStep?: (delta: 1 | -1) => void;
}

export interface ExhibitMode {
  /** Whether the exhibition screen should be on show. */
  active: boolean;
  /**
   * Attach to the element that becomes the fullscreen surface. A callback ref,
   * not a ref object — see the note where it is built.
   */
  attachScreen: (node: HTMLDivElement | null) => void;
  /** True in real fullscreen; false while we are only an overlay. */
  fullscreen: boolean;
  /** True once the pointer has sat still long enough to be taken off screen. */
  idle: boolean;
  /** The dial in progress (`2--`, `---`), or `null` when there is nothing to say. */
  readout: string | null;
  /** Go to the exhibition screen. */
  enter(): void;
  /** Come back to the ordinary screen, on the same page. */
  exit(): void;
}

/**
 * Wire a watching screen for exhibition.
 *
 * Safe to call unconditionally: until it is `active` the only thing this does
 * is listen for the chord.
 */
export function useExhibitMode(controls: ExhibitControls = {}): ExhibitMode {
  const { onPageEntry, onPageStep, onSubpageStep } = controls;

  const [searchParams, setSearchParams] = useSearchParams();
  const requested = isExhibitParam(searchParams.get(EXHIBIT_PARAM));

  /*
   * Two ways in, one state.
   *
   * The parameter is read rather than copied into state: it is already the
   * answer on the render it arrives on, so a machine started at
   * `/watch/243?exhibit=1` never paints an ordinary watching screen first and
   * then replaces it. The chord's own flag sits beside it, and the screen is up
   * if either says so.
   *
   * Which is why leaving has to take the parameter off the URL as well as
   * clearing the flag: with it still there, `active` would be true again on the
   * very next render and Escape would look like a key that does nothing.
   */
  const [entered, setEntered] = useState(false);
  const active = requested || entered;

  const [fullscreen, setFullscreen] = useState(false);
  const [cursorIdle, setCursorIdle] = useState(false);
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);

  const { readout, press, reset } = useDialPad(onPageEntry);

  /*
   * A callback ref rather than a ref object, so the element is *state*.
   *
   * The fullscreen effect below cannot run until the element it is going to
   * request fullscreen on exists, and a ref object gives it no way to know
   * when that happened. As state it is a dependency like any other: the screen
   * mounts, this fires, the effect runs with something to hand the API.
   */
  const attachScreen = useCallback((node: HTMLDivElement | null) => {
    setScreen(node);
  }, []);

  const enter = useCallback(() => setEntered(true), []);

  const exit = useCallback(() => {
    setEntered(false);
    setSearchParams(
      (prev) => {
        if (!prev.has(EXHIBIT_PARAM)) return prev;
        const next = new URLSearchParams(prev);
        next.delete(EXHIBIT_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /*
   * `exit` through a ref, for the one effect that must not be re-run.
   *
   * React Router rebuilds `setSearchParams` — and therefore `exit` — whenever
   * the query string changes, so listing `exit` as a dependency of the
   * fullscreen effect would tear it down and set it up again on an unrelated
   * navigation. Its teardown *leaves fullscreen*, and the setup that follows
   * cannot get back in without a gesture, so the screen would silently fall
   * back to an overlay partway through an exhibition. Declared above that
   * effect, so the ref is always current by the time anything reads it.
   */
  const exitRef = useRef(exit);
  useEffect(() => {
    exitRef.current = exit;
  }, [exit]);

  /*
   * Fullscreen: ask, and keep asking until a gesture makes it stick.
   *
   * See the note at the top of this file for why the first attempt is expected
   * to fail on the URL-parameter path, and why that is not treated as an error.
   */
  useEffect(() => {
    if (!active || screen == null) return;

    let pending = false;

    const attempt = (event?: Event) => {
      // Escape is on its way out of the mode, not into fullscreen; asking on
      // that keystroke would fight the exit by a frame.
      if (event instanceof KeyboardEvent && event.key === 'Escape') return;
      if (pending || isFullscreen()) return;
      pending = true;
      requestFullscreen(screen).then(
        () => {
          pending = false;
        },
        () => {
          // Refused — stay an overlay, and let the next gesture have a go.
          pending = false;
        },
      );
    };

    const onFullscreenChange = () => {
      const inFullscreen = isFullscreen();
      setFullscreen(inFullscreen);
      // Escape in true fullscreen is swallowed by the browser: the page is
      // never told about the keystroke, only that it is no longer fullscreen.
      // Leaving fullscreen is therefore the same instruction as Escape on the
      // overlay, and this is the only place that hears it.
      if (!inFullscreen) exitRef.current();
    };

    attempt();
    window.addEventListener('pointerdown', attempt);
    window.addEventListener('keydown', attempt);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    return () => {
      window.removeEventListener('pointerdown', attempt);
      window.removeEventListener('keydown', attempt);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      exitFullscreen();
      setFullscreen(false);
    };
  }, [active, screen]);

  /*
   * Keep the display awake.
   *
   * Feature-detected and silent on failure: a lock is a nicety and a refused
   * one must not cost anybody a picture. It is dropped by the browser whenever
   * the tab stops being visible and is never handed back on its own, so it is
   * asked for again each time the page comes back — which on an exhibition
   * machine is what happens after somebody switches to another window and back.
   */
  useEffect(() => {
    if (!active) return;
    const wakeLock = (navigator as unknown as WakeLockNavigator).wakeLock;
    if (wakeLock == null) return;

    let sentinel: WakeLockSentinel | null = null;
    let finished = false;

    const acquire = () => {
      if (finished || sentinel != null || document.visibilityState !== 'visible') return;
      wakeLock.request('screen').then(
        (granted) => {
          if (finished) {
            void granted.release().catch(ignore);
            return;
          }
          sentinel = granted;
          granted.addEventListener('release', () => {
            sentinel = null;
          });
        },
        ignore,
      );
    };

    const onVisibility = () => acquire();

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      finished = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(ignore);
    };
  }, [active]);

  /*
   * The keyboard, which is the only control there is.
   *
   * Bound to the window rather than to the screen element because the chord has
   * to work before the screen exists, and because a fullscreen element is not
   * reliably the focused one — a keystroke arriving at `<body>` still has to
   * change the page.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.shiftKey && event.key.toLowerCase() === TOGGLE_KEY) {
        // Held down, a chord would flap in and out of fullscreen many times a
        // second. One press is one toggle.
        if (event.repeat) return;
        event.preventDefault();
        // Not one setter flipped: `active` is two sources OR'd together (the URL
        // parameter and this flag), so leaving has to go through `exit`, which
        // clears the parameter too. Toggling `entered` alone would let a chord
        // pressed on `/watch?exhibit=1` clear the flag and change nothing.
        if (active) exit();
        else enter();
        return;
      }

      if (!active) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        exit();
        return;
      }

      // A held arrow scanning through pages is useful and looks like a set
      // being wound on; a held digit dialling `111` is neither.
      if (isDialDigit(event.key)) {
        if (event.repeat) return;
        event.preventDefault();
        press(event.key);
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          onPageStep?.(1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          onPageStep?.(-1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          onSubpageStep?.(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          onSubpageStep?.(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, enter, exit, press, onPageStep, onSubpageStep]);

  // Nothing half dialled survives the screen going away, in either direction:
  // the digits belong to the session in front of the television.
  useEffect(() => {
    if (active) return;
    reset();
  }, [active, reset]);

  /*
   * Take the pointer off the picture once it stops moving.
   *
   * An arrow sitting in the middle of a page for the length of an exhibition is
   * the last piece of browser left on the glass. It comes back the moment the
   * mouse does, so whoever is looking after the room can still find it.
   */
  useEffect(() => {
    // No `setCursorIdle(false)` on the way out: `idle` below is only ever true
    // while the screen is up, so a stale flag cannot be seen from outside and
    // clearing it here would be a synchronous write from an effect body for no
    // observable gain. Re-entering calls `wake` on setup, which clears it.
    if (!active) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setCursorIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
    };

    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [active]);

  // The page behind is still there in the overlay fallback, and a scrollbar
  // down the side of it would show — as a scrollbar, and as a hundred
  // viewport-width units that no longer match what is visible.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add(LOCK_CLASS);
    return () => root.classList.remove(LOCK_CLASS);
  }, [active]);

  /*
   * The cursor is only ever hidden while the screen is up. Derived rather than
   * reset on exit, so leaving cannot strand a hidden pointer on the ordinary
   * watching screen if the teardown is ever reordered.
   */
  const idle = active && cursorIdle;

  return { active, attachScreen, fullscreen, idle, readout, enter, exit };
}
