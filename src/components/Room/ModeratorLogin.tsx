/**
 * ModeratorLogin — the `/moderator` screen.
 *
 * A password form that signs this browser in as the admin. Unlike the version
 * this replaces, the check happens on the server and the resulting session is
 * an `HttpOnly` cookie, so it is real authentication rather than a UI-level
 * gate: the password is no longer part of the bundle, and the session can no
 * longer be granted from the devtools console.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { signInAsAdmin, signOutAsAdmin } from '../../collab/adminSession';
import { useAdminStatus } from '../../collab/useIsModerator';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';

/** What to tell the operator when a sign-in attempt does not succeed. */
const MESSAGES: Record<string, string> = {
  incorrect: 'Incorrect password.',
  unconfigured:
    'This deployment has no admin password set (ADMIN_PASSWORD and SESSION_SECRET).',
  network: 'Could not reach the server. Check your connection and try again.',
};

export function ModeratorLogin() {
  const { admin, loading, configured } = useAdminStatus();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await signInAsAdmin(password);
    setBusy(false);

    if (result.ok) {
      setError(null);
      setPassword('');
    } else {
      setError(MESSAGES[result.reason] ?? MESSAGES.incorrect);
    }
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <h1 className="landing-title">MODERATOR</h1>
      </header>

      <section className="landing-options" aria-label="Moderator sign-in">
        {loading ? (
          <p className="landing-section-description">Checking sign-in…</p>
        ) : admin ? (
          <div className="landing-section">
            <p className="landing-section-description">
              This browser is signed in as the moderator: the editor's archive
              pages (100–{PLAYGROUND_MIN_PAGE - 1}) are open to edit here,
              alongside the playground.
            </p>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => void signOutAsAdmin()}
            >
              Sign out
            </button>
          </div>
        ) : (
          <form
            className="landing-name-form"
            onSubmit={(e) => void handleSubmit(e)}
            noValidate
          >
            <label className="sidebar-field-label" htmlFor="moderator-password-input">
              Password
            </label>
            <input
              id="moderator-password-input"
              type="password"
              className="landing-name-input"
              value={password}
              autoComplete="current-password"
              autoFocus
              disabled={busy || !configured}
              aria-invalid={error != null}
              aria-describedby={error != null ? 'moderator-password-error' : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
            />
            {!configured && error == null && (
              <p className="room-entry-error" role="status">
                {MESSAGES.unconfigured}
              </p>
            )}
            {error != null && (
              <p id="moderator-password-error" className="room-entry-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="sidebar-action-btn"
              disabled={busy || !configured}
            >
              {busy ? 'Signing in…' : 'Sign in'}
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
