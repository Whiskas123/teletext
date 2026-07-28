/**
 * ModeratorLogin — the `/moderator` screen.
 *
 * A passcode form that marks this device as the moderator (see
 * `collab/moderator.ts` for what that does and doesn't guarantee — there's no
 * backend, so this is a UI-level gate against accidental archive edits, not
 * real authentication). Once recognized, the editor's page picker stops
 * restricting which pages can be opened.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { clearModerator, trySetModerator } from '../../collab/moderator';
import { useIsModerator } from '../../collab/useIsModerator';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';

export function ModeratorLogin() {
  const isModerator = useIsModerator();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (trySetModerator(passcode)) {
      setError(null);
      setPasscode('');
    } else {
      setError('Incorrect passcode.');
    }
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <h1 className="landing-title">MODERATOR</h1>
      </header>

      <section className="landing-options" aria-label="Moderator sign-in">
        {isModerator ? (
          <div className="landing-section">
            <p className="landing-section-description">
              This device is recognized as the moderator: the editor's archive
              pages (100–{PLAYGROUND_MIN_PAGE - 1}) are open to edit here,
              alongside the playground.
            </p>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={clearModerator}
            >
              Sign out as moderator
            </button>
          </div>
        ) : (
          <form className="landing-name-form" onSubmit={handleSubmit} noValidate>
            <label className="sidebar-field-label" htmlFor="moderator-passcode-input">
              Passcode
            </label>
            <input
              id="moderator-passcode-input"
              type="password"
              className="landing-name-input"
              value={passcode}
              autoComplete="off"
              autoFocus
              aria-invalid={error != null}
              aria-describedby={error != null ? 'moderator-passcode-error' : undefined}
              onChange={(e) => {
                setPasscode(e.target.value);
                if (error) setError(null);
              }}
            />
            {error != null && (
              <p id="moderator-passcode-error" className="room-entry-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="sidebar-action-btn">
              Sign in
            </button>
          </form>
        )}
        <Link to="/" className="room-back-link">
          &lt; Back to home
        </Link>
      </section>
    </div>
  );
}

export default ModeratorLogin;
