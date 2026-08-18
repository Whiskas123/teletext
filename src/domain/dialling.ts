/**
 * dialling — what a teletext set does between the first digit and the page.
 *
 * Three digits, then go. Nothing happens on the first two except that the set
 * shows you it heard them, which is the whole of the interaction and also the
 * whole of the difficulty: the entry is a small state machine with two timers
 * hanging off it, and it was written out longhand inside {@link CrtTelevision}
 * because that was the only place that had a keypad.
 *
 * The exhibition screen has no keypad and dials all the same — the keyboard is
 * the only control it has (see {@link useExhibitMode}) — so the rules moved
 * here, where neither caller owns them. They are the set's rules, not the front
 * panel's:
 *
 * - Digits accumulate until there are three, and the third resolves the entry
 *   one way or the other. There is no "enter" and no backspace; a real set had
 *   neither, and adding one now would be inventing a television.
 * - Only 100–999 name a page. `042` is refused with `---` rather than quietly
 *   rounded up to something valid, because a set that goes somewhere you did
 *   not ask for is worse than one that says no.
 * - A number left half dialled is forgotten after {@link DIAL_TIMEOUT_MS}. That
 *   is not tidiness: without it, a `2` pressed and abandoned would still be
 *   sitting there minutes later waiting to be completed by the next two digits
 *   somebody typed, and they would land on page 2xx having asked for xx-
 *   something.
 *
 * Pure and framework-free. The timers belong to whoever is holding the state —
 * see `useDialPad`.
 */

/** A half-dialled page number is abandoned after this long, as a real set does. */
export const DIAL_TIMEOUT_MS = 3000;

/** How long `---` shows after a page number that cannot exist. */
export const DIAL_ERROR_MS = 700;

/** Lowest and highest Page_Number a keypad entry can name. */
export const MIN_DIALLED_PAGE = 100;
export const MAX_DIALLED_PAGE = 999;

/** How many digits make one entry. Three, and it was always three. */
export const DIAL_LENGTH = 3;

/** What the window shows for a digit not yet pressed, and for a refusal. */
const DIAL_BLANK = '-';

/** What pressing one digit did. */
export interface DialPress {
  /**
   * The digits still standing after the press: one or two while an entry is
   * being collected, and `''` once the third has resolved it — a set forgot the
   * number the instant it acted on it.
   */
  digits: string;
  /** The page to go to, or `null` while the entry is still incomplete. */
  page: number | null;
  /** A complete entry that names no page: the set's `---`. */
  refused: boolean;
}

/** Whether a pressed key is one of the ten the keypad has. */
export function isDialDigit(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9';
}

/**
 * Press one digit against the digits already collected.
 *
 * `digits` is whatever the caller is holding — `''` when nothing is being
 * dialled. The result is the whole of the outcome, so the caller never has to
 * work out for itself whether the entry is finished.
 */
export function pressDigit(digits: string, digit: string): DialPress {
  const next = digits + digit;
  if (next.length < DIAL_LENGTH) {
    return { digits: next, page: null, refused: false };
  }

  const target = Number(next);
  if (target < MIN_DIALLED_PAGE || target > MAX_DIALLED_PAGE) {
    return { digits: '', page: null, refused: true };
  }

  return { digits: '', page: target, refused: false };
}

/**
 * The three characters the set puts up while you are dialling, or `null` when
 * there is nothing to say and the page number itself should show.
 *
 * `2--` is what told you the set had heard the first press and was waiting for
 * the rest; `---` is what it said when the number could not exist. A refusal
 * wins over the digits because a refusal *clears* them, so the two never
 * disagree about anything except during the {@link DIAL_ERROR_MS} in which a
 * fresh entry has been started underneath a refusal still on screen. Showing
 * the refusal through that is the older behaviour and the honest one: the set
 * is still saying no to the last thing you asked for.
 */
export function dialReadout(digits: string, refused: boolean): string | null {
  if (refused) return DIAL_BLANK.repeat(DIAL_LENGTH);
  if (digits === '') return null;
  return digits.padEnd(DIAL_LENGTH, DIAL_BLANK);
}
