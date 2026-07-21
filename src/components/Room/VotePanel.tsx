/**
 * VotePanel — the room "remote control" and live voting UI (Requirement 4).
 *
 * Design notes (see design.md "Presentation components" and Req 4):
 * - A remote control: a numeric Page_Number input (1..999) plus a submit button
 *   that proposes a Change_Request via {@link useVoting}'s `submit`. A rejected
 *   submission surfaces an inline validation message — `'out-of-range'` when the
 *   target is not an integer 1..999 (Req 4.11 range guard, exposed here for the
 *   submit control) or `'active-exists'` when a request is already active
 *   (Req 4.2).
 * - While a Change_Request is active the submit control is disabled (Req 4.2)
 *   and the panel shows the requested target, the live tally (accept / reject
 *   out of the fixed Vote_Base with its Accept_Threshold), and Accept / Reject
 *   buttons that record the local member's Vote via `vote` (Req 4.5).
 * - A rejected Vote is reflected with a subtle message — `'already-voted'`
 *   (Req 4.4) or `'ineligible'` (a member who joined after creation, Req 4.8).
 *
 * The component is self-contained: it reads and writes all shared voting state
 * through {@link useVoting} and holds only local input/message UI state.
 *
 * Requirements: 4.1, 4.2, 4.5.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useVoting } from '../../collab/useVoting';
import type { SubmitResult, VoteResult } from '../../collab/useVoting';

/** Heading for the remote-control / voting panel. */
export const VOTE_PANEL_HEADING = 'Request a page';

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
  return String(n).padStart(3, '0');
}

/**
 * Render the remote control (propose a page change) and, while a Change_Request
 * is active, the live tally and Accept / Reject controls.
 */
export function VotePanel() {
  const { active, submit, vote, tally } = useVoting();

  const [draftTarget, setDraftTarget] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);

  const isActive = active !== null;

  // Clear any stale vote message once the active request resolves/changes so
  // messages never linger across separate votes.
  useEffect(() => {
    setVoteMessage(null);
  }, [active?.id]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const target = parseInt(draftTarget, 10);
    const result: SubmitResult = submit(target);
    if (!result.ok) {
      setSubmitError(SUBMIT_MESSAGES[result.reason] ?? 'Unable to submit');
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

  return (
    <section className="vote-panel" aria-label="Remote control and voting">
      <h2 className="sidebar-heading">{VOTE_PANEL_HEADING}</h2>

      <form className="vote-remote" onSubmit={handleSubmit} noValidate>

        <div className="vote-remote-row">
          <input
            id="vote-target-input"
            className="vote-target-input"
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
            className="sidebar-action-btn vote-submit-btn"
            disabled={isActive}
          >
            Request
          </button>
        </div>
        {submitError && (
          <p id="vote-submit-error" className="vote-error" role="alert">
            {submitError}
          </p>
        )}
      </form>

      {isActive && active && (
        <div className="vote-active" aria-live="polite">
          <p className="vote-active-target">
            Change to page{' '}
            <span className="vote-active-page">
              {formatPageNumber(active.target)}
            </span>
            ?
          </p>

          <dl className="vote-tally" aria-label="Current vote tally">
            <div className="vote-tally-item">
              <dt>Accept</dt>
              <dd>{tally.accept}</dd>
            </div>
            <div className="vote-tally-item">
              <dt>Reject</dt>
              <dd>{tally.reject}</dd>
            </div>
            <div className="vote-tally-item">
              <dt>Needed</dt>
              <dd>
                {tally.threshold} of {tally.base}
              </dd>
            </div>
          </dl>

          <div className="vote-actions">
            <button
              type="button"
              className="sidebar-action-btn vote-accept-btn"
              onClick={() => handleVote('accept')}
            >
              Accept
            </button>
            <button
              type="button"
              className="sidebar-action-btn vote-reject-btn"
              onClick={() => handleVote('reject')}
            >
              Reject
            </button>
          </div>

          {voteMessage && (
            <p className="vote-message" role="status">
              {voteMessage}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default VotePanel;
