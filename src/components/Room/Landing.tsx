import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { validateDisplayName } from '../../domain/identity';
import { getStoredDisplayName, setStoredDisplayName } from '../../collab/session';
import { ROOMS } from './rooms';

/**
 * Landing — the app's entry screen shown at `/`.
 *
 * Two stages on one page:
 *  1. **Name capture** — the project title, a short description, and a required
 *     name field. The entered name is validated (1–32 characters) and persisted
 *     for the session so every room attributes this member's actions to it.
 *  2. **Watch or edit** — two clearly separated areas:
 *     - "Watch together": the six fixed rooms, each with a single "Watch"
 *       action that navigates into the room viewer (`/room/:roomId`).
 *     - "Edit teletext": a single "Open the editor" action that opens the solo
 *       editor (`/edit`).
 *     Rooms have no per-room edit control — editing is global and solo.
 *
 * If a name was already chosen earlier in the session the page skips straight to
 * the watch/edit areas, while still offering a "change name" control.
 */

const PROJECT_TITLE = 'TELETEXT ROOMS';
const PROJECT_DESCRIPTION =
  'Gather in a room and watch teletext together in real time. Flip through pages as a group and vote on what to view next, or open the editor to create and edit pages on your own.';

export function Landing() {
  const navigate = useNavigate();

  const [name, setName] = useState<string | null>(() => getStoredDisplayName());
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // When true, show the name form even though a name is already stored.
  const [editingName, setEditingName] = useState(false);

  const hasName = name != null && !editingName;

  function handleNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (!validateDisplayName(trimmed)) {
      setError('Please enter a name between 1 and 32 characters.');
      return;
    }
    setStoredDisplayName(trimmed);
    setName(trimmed);
    setDraftName('');
    setError(null);
    setEditingName(false);
  }

  function handleWatchRoom(roomId: string) {
    navigate(`/room/${roomId}`);
  }

  function handleOpenEditor() {
    navigate('/edit');
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <h1 className="landing-title">{PROJECT_TITLE}</h1>
        <p className="landing-description">{PROJECT_DESCRIPTION}</p>
      </header>

      {!hasName ? (
        <section className="landing-name" aria-labelledby="landing-name-heading">
          <h2 id="landing-name-heading" className="sidebar-heading">
            What should we call you?
          </h2>
          <form className="landing-name-form" onSubmit={handleNameSubmit} noValidate>
            <label className="sidebar-field-label" htmlFor="landing-name-input">
              Your name
            </label>
            <input
              id="landing-name-input"
              type="text"
              className="landing-name-input"
              value={draftName}
              maxLength={32}
              placeholder="e.g. Ada"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-invalid={error != null}
              aria-describedby={error != null ? 'landing-name-error' : undefined}
              onChange={(e) => {
                setDraftName(e.target.value);
                if (error) setError(null);
              }}
            />
            {error != null && (
              <p id="landing-name-error" className="room-entry-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="sidebar-action-btn">
              Continue
            </button>
          </form>
        </section>
      ) : (
        <section className="landing-rooms" aria-labelledby="landing-rooms-heading">
          <div className="landing-greeting">
            <span>
              Watching as <strong>{name}</strong>
            </span>
            <button
              type="button"
              className="landing-change-name-btn"
              onClick={() => {
                setDraftName(name ?? '');
                setEditingName(true);
              }}
            >
              Change name
            </button>
          </div>

          <div className="landing-section landing-watch">
            <h2
              id="landing-rooms-heading"
              className="sidebar-heading landing-section-heading"
            >
              Watch together
            </h2>
            <p className="landing-section-description">
              Join one of the rooms to watch teletext together.
            </p>
            <ul className="room-picker-grid">
              {ROOMS.map((room) => (
                <li key={room.id} className="room-picker-item">
                  <div className="room-picker-card">
                    <span className="room-picker-card-label">{room.label}</span>
                    <div className="room-picker-actions">
                      <button
                        type="button"
                        className="room-picker-action room-picker-watch"
                        onClick={() => handleWatchRoom(room.id)}
                        aria-label={`Watch teletext in ${room.label}`}
                      >
                        Watch
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="landing-section landing-edit">
            <h2 className="sidebar-heading landing-section-heading">
              Edit teletext
            </h2>
            <p className="landing-section-description">
              Open the editor to create or change a page on your own: your edits show up wherever the page is watched.
            </p>
            <button
              type="button"
              className="sidebar-action-btn landing-open-editor-btn"
              onClick={handleOpenEditor}
              aria-label="Open the teletext editor"
            >
              Open the editor
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default Landing;
