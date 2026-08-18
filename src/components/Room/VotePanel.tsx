/**
 * VotePanel — the room's vote console (Requirement 4).
 *
 * A room decides together what it is watching, and this is the box that decision
 * is made on: a segment visor reporting the page in question and the count
 * either side of it, two moulded keys to answer with, and a dial to ask with. It
 * stands beside the television and is meant to have come out of the same
 * factory — the visor is the set's own LED window with a third readout in it
 * (see {@link SegmentVisor}), the caps are the panel's plastic restated in CSS
 * (`--rc-*` in `App.css`, lifted off the editor console), and the two coloured
 * ones are the fastext red and green, because those are the only two colours
 * this television has.
 *
 * It replaces a plain form of a number field, a Request button and a definition
 * list of counts. The form worked and read as a web page parked next to a
 * photograph of a television, which is the one thing on this screen that must
 * not happen.
 *
 * ## What the visor says
 *
 * - **Idle** — every segment dark. Not blank: the digits are still there behind
 *   the filter, unlit, which is what an LED window looks like with nothing to
 *   report and is why the plate is never an empty box.
 * - **A vote running** — the page asked for, the votes in favour, the votes
 *   against, with `NEEDED n OF m` engraved under it (the Accept_Threshold out of
 *   the fixed Vote_Base, Req 4.5/4.6).
 * - **Just resolved** — the closing reading is held for a few seconds with
 *   `CARRIED` / `NOT CARRIED` under it, then the visor goes dark. Whether it
 *   carried is read off the last tally the console saw rather than from the
 *   request, which is gone by then: {@link useVoting} clears the active slot on
 *   resolution (Req 4.10) and applies the target itself (Req 4.6), so by the
 *   time this panel hears about it there is nothing left to ask.
 * - **Refused** — `---`, the same three dashes the set's own window shows a page
 *   number that cannot exist, with the reason spelled out underneath.
 *
 * ## What it does
 *
 * Everything through {@link useVoting}: `submit` proposes a Change_Request
 * (rejected as `'out-of-range'` for a target outside 1..999, Req 4.11, or
 * `'active-exists'` while one is already running, Req 4.2 — which is also why
 * the dial goes dead for the duration), and `vote` records this member's Vote
 * (rejected as `'already-voted'`, Req 4.4, `'ineligible'` for a member who
 * joined after the request was created, Req 4.8, or `'not-active'` for a request
 * that resolved between the render and the press). Every rejection is spoken on
 * the message line under the keys; nothing is swallowed.
 *
 * The set's front panel proposes too — dialling in a room asks rather than
 * changes (see {@link RoomViewer}) — so this console is not the only way in, and
 * a request that arrives from the television or from the directory lights the
 * visor just the same.
 *
 * Requirements: 4.1, 4.2, 4.5.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useVoting } from '../../collab/useVoting';
import type { SubmitResult, VoteResult } from '../../collab/useVoting';
import SegmentVisor from '../chrome/SegmentVisor';

/** The console's nameplate. */
export const VOTE_PANEL_HEADING = 'Vote';

/** How long the visor holds the closing reading after a vote resolves. */
const SETTLE_MS = 4500;

/**
 * How long `---` stands in the visor after a refused request — the set's own
 * `DIAL_ERROR_MS`, so the two windows blink for the same length of time.
 */
const REFUSAL_MS = 700;

/** Human-readable messages for each submit rejection reason. */
const SUBMIT_MESSAGES: Record<string, string> = {
  'out-of-range': 'Enter a page number between 100 and 999',
  'active-exists': 'A vote is already in progress',
};

/** Human-readable messages for each vote rejection reason. */
const VOTE_MESSAGES: Record<string, string> = {
  'already-voted': 'You have already voted',
  ineligible: 'You joined after this vote started and cannot vote',
  'not-active': 'This vote is no longer active',
};

/** Format a Page_Number as three digits (e.g. 7 -> "007"). */
function formatPageNumber(n: number): string {
  return String(n).padStart(3, '0').slice(-3);
}

/** Format a count for a two-digit readout, which is all a bay of one holds. */
function formatCount(n: number): string {
  return String(n).padStart(2, '0').slice(-2);
}

/** What the console is currently reporting. Drives the visor, legend and lamp. */
type ConsoleState = 'idle' | 'live' | 'carried' | 'lost' | 'refused';

/** The closing reading of a vote, held on the visor for a moment after it ends. */
interface SettledVote {
  target: number;
  accept: number;
  reject: number;
  carried: boolean;
}

/**
 * Render the room's vote console: the visor, the Accept / Reject keys, and the
 * dial that proposes a page.
 */
export function VotePanel() {
  const { active, submit, vote, tally } = useVoting();

  const [draftTarget, setDraftTarget] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettledVote | null>(null);
  const [refused, setRefused] = useState(false);

  const isActive = active !== null;

  // Clear any stale vote message once the active request resolves/changes so
  // messages never linger across separate votes.
  useEffect(() => {
    setVoteMessage(null);
  }, [active?.id]);

  /*
   * The running reading, kept one step behind so the console has something to
   * show once the request is gone.
   *
   * Resolution happens elsewhere and arrives here as `active` simply becoming
   * null — no outcome, no final counts, nothing to look at. So the last reading
   * of a live vote is held in a ref, and the moment the slot empties it becomes
   * the closing one: carried if the accepts had reached the threshold, and not
   * carried otherwise, which covers a rejection and an expiry alike. Neither
   * changed the page, and the console has no business claiming to know which of
   * the two it was.
   */
  const runningRef = useRef<{
    target: number;
    accept: number;
    reject: number;
    threshold: number;
  } | null>(null);

  useEffect(() => {
    if (active) {
      runningRef.current = {
        target: active.target,
        accept: tally.accept,
        reject: tally.reject,
        threshold: tally.threshold,
      };
      setSettled(null);
      return;
    }
    const closing = runningRef.current;
    if (closing === null) return;
    runningRef.current = null;
    setSettled({
      target: closing.target,
      accept: closing.accept,
      reject: closing.reject,
      carried: closing.accept >= closing.threshold,
    });
    const timer = setTimeout(() => setSettled(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, tally.accept, tally.reject, tally.threshold]);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(false), REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const target = parseInt(draftTarget, 10);
    const result: SubmitResult = submit(target);
    if (!result.ok) {
      setSubmitError(SUBMIT_MESSAGES[result.reason] ?? 'Unable to submit');
      setRefused(true);
      return;
    }
    setSubmitError(null);
    setDraftTarget('');
  };

  const handleVote = (decision: 'accept' | 'reject') => {
    const result: VoteResult = vote(decision);
    if (!result.ok) {
      setVoteMessage(VOTE_MESSAGES[result.reason] ?? 'Vote not recorded');
      return;
    }
    setVoteMessage(null);
  };

  /*
   * One reading, chosen once, and everything below is a view of it: the visor
   * lights it, the legend spells it out, the lamp colours it and the label reads
   * it aloud. A live request outranks a closing one, which outranks a refusal —
   * a refusal while a vote runs is a refusal *of* the thing on the visor, so
   * blanking the visor to say so would take away the reason.
   */
  const state: ConsoleState = isActive
    ? 'live'
    : settled
      ? settled.carried
        ? 'carried'
        : 'lost'
      : refused
        ? 'refused'
        : 'idle';

  const reading =
    state === 'live' && active
      ? {
          page: formatPageNumber(active.target),
          favour: formatCount(tally.accept),
          against: formatCount(tally.reject),
        }
      : (state === 'carried' || state === 'lost') && settled
        ? {
            page: formatPageNumber(settled.target),
            favour: formatCount(settled.accept),
            against: formatCount(settled.reject),
          }
        : state === 'refused'
          ? { page: '---', favour: '--', against: '--' }
          : // Idle: unlit, not empty. Every segment is still there, dark.
            { page: '   ', favour: '  ', against: '  ' };

  const spoken =
    state === 'live' && active
      ? `Page ${formatPageNumber(active.target)}: ${tally.accept} in favour, ${
          tally.reject
        } against, ${tally.threshold} of ${tally.base} needed`
      : state === 'carried' && settled
        ? `Page ${formatPageNumber(settled.target)} carried, ${settled.accept} to ${
            settled.reject
          }`
        : state === 'lost' && settled
          ? `Page ${formatPageNumber(settled.target)} not carried, ${settled.accept} to ${
              settled.reject
            }`
          : state === 'refused'
            ? 'Request refused'
            : 'No vote in progress';

  const legend =
    state === 'live'
      ? `Needed ${tally.threshold} of ${tally.base}`
      : state === 'carried'
        ? 'Carried'
        : state === 'lost'
          ? 'Not carried'
          : 'No vote in progress';

  return (
    <section className="room-console vote-console" aria-label="Room vote">
      <div className="rc-nameplate">
        <h2 className="rc-nameplate-name">{VOTE_PANEL_HEADING}</h2>
        <span className="rc-lamp" data-state={state} aria-hidden="true" />
      </div>

      <SegmentVisor
        className="vote-visor"
        readouts={[
          { digits: reading.page, caption: 'PAGE' },
          { digits: reading.favour, caption: 'FOR', small: true },
          { digits: reading.against, caption: 'AGAINST', small: true },
        ]}
        label={spoken}
      />

      {/* The one line of the panel that changes what it says, so it is also the
          one the screen reader is told to watch. */}
      <p className="rc-legend vote-legend" data-state={state} role="status" aria-live="polite">
        {legend}
      </p>

      {/*
        * Both keys stay moulded in whether or not there is anything to vote on,
        * dead until there is. A control that disappears between votes reads as a
        * fault on a panel; a dead one reads as "not now", which is the truth.
        */}
      <div className="vote-keys">
        <button
          type="button"
          className="rc-key vote-key vote-key-accept"
          onClick={() => handleVote('accept')}
          disabled={!isActive}
        >
          Accept
        </button>
        <button
          type="button"
          className="rc-key vote-key vote-key-reject"
          onClick={() => handleVote('reject')}
          disabled={!isActive}
        >
          Reject
        </button>
      </div>

      {voteMessage && (
        <p className="rc-note vote-message" role="status">
          {voteMessage}
        </p>
      )}

      <form className="vote-dial" onSubmit={handleSubmit} noValidate>
        <label className="rc-legend" htmlFor="vote-target-input">
          Ask for a page
        </label>
        <div className="vote-dial-row">
          <input
            id="vote-target-input"
            className="rc-field vote-dial-field"
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={draftTarget}
            placeholder="100"
            disabled={isActive}
            aria-invalid={submitError !== null}
            aria-describedby={submitError ? 'vote-submit-error' : undefined}
            onChange={(event) => {
              // Digits only, up to 3 — a plain text field so it can be typed and
              // cleared freely (a controlled number input fought back).
              setDraftTarget(event.target.value.replace(/\D/g, '').slice(0, 3));
              if (submitError) {
                setSubmitError(null);
              }
            }}
          />
          <button
            type="submit"
            className="rc-key vote-key vote-key-request"
            disabled={isActive}
          >
            Request
          </button>
        </div>
        {submitError && (
          <p id="vote-submit-error" className="rc-note vote-error" role="alert">
            {submitError}
          </p>
        )}
      </form>
    </section>
  );
}

export default VotePanel;
