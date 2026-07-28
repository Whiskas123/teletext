import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRoomOccupancy } from '../../collab/useRoomOccupancy';
import { ROOMS } from './rooms';

/**
 * Landing — the app's entry screen shown at `/`.
 *
 * Three ways in, none of which asks for anything up front:
 *  - **Watch solo** (`/watch`) — the TV on your own. No chat, no vote, so no
 *    name is needed.
 *  - **Watch together** — reveals the six fixed rooms, each with its live
 *    occupancy, and enters the room viewer (`/room/:roomId`). A name is
 *    optional here too: members start as `Guest-XXXX` and can rename themselves
 *    from the room sidebar.
 *  - **Create / edit pages** (`/edit`) — the solo editor for the global pages.
 */

const PROJECT_TITLE = 'TELETEXT ROOMS';
const PROJECT_DESCRIPTION =
  'Watch teletext on your own, gather in a room and watch it together in real time, or open the editor to create and change pages.';

/** The entry options, in display order. */
type Option = 'solo' | 'together' | 'edit';

export function Landing() {
  const navigate = useNavigate();

  // Which option's detail is expanded. Only "Watch together" has one (the room
  // grid); the others navigate straight away.
  const [expanded, setExpanded] = useState<Option | null>(null);

  const occupancy = useRoomOccupancy(ROOMS.map((r) => r.id));

  function handleWatchRoom(roomId: string) {
    navigate(`/room/${roomId}`);
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <h1 className="landing-title">{PROJECT_TITLE}</h1>
        <p className="landing-description">{PROJECT_DESCRIPTION}</p>
      </header>

      <section className="landing-options" aria-label="Choose how to start">
        <ul className="landing-option-grid">
          <li className="landing-option">
            <button
              type="button"
              className="landing-option-card"
              onClick={() => navigate('/watch')}
              aria-label="Watch teletext solo"
            >
              <span className="landing-option-title">Watch solo</span>
              <span className="landing-option-description">
                Just you and the TV. Flip through pages whenever you like.
              </span>
            </button>
          </li>

          <li className="landing-option">
            <button
              type="button"
              className={`landing-option-card${expanded === 'together' ? ' landing-option-card-active' : ''}`}
              onClick={() =>
                setExpanded((o) => (o === 'together' ? null : 'together'))
              }
              aria-expanded={expanded === 'together'}
              aria-controls="landing-rooms"
              aria-label="Watch teletext together"
            >
              <span className="landing-option-title">Watch together</span>
              <span className="landing-option-description">
                Join a room to watch with others, chat, and vote on the next
                page.
              </span>
            </button>
          </li>

          <li className="landing-option">
            <button
              type="button"
              className="landing-option-card"
              onClick={() => navigate('/edit')}
              aria-label="Create or edit teletext pages"
            >
              <span className="landing-option-title">Create / edit pages</span>
              <span className="landing-option-description">
                Draw and write pages. Your edits show up wherever the page is
                watched.
              </span>
            </button>
          </li>
        </ul>
      </section>

      {expanded === 'together' && (
        <section
          id="landing-rooms"
          className="landing-section landing-watch"
          aria-labelledby="landing-rooms-heading"
        >
          <h2
            id="landing-rooms-heading"
            className="sidebar-heading landing-section-heading"
          >
            Pick a room
          </h2>
          <p className="landing-section-description">
            You'll join as a guest — you can change your name once you're in.
          </p>
          <ul className="room-picker-grid">
            {ROOMS.map((room) => {
              const count = occupancy[room.id] ?? 0;
              return (
                <li key={room.id} className="room-picker-item">
                  <div className="room-picker-card">
                    <span className="room-picker-card-label">{room.label}</span>
                    <span
                      className={`room-picker-occupancy${count > 0 ? ' room-picker-occupancy-active' : ''}`}
                    >
                      {count > 0 ? `${count} watching` : 'Empty'}
                    </span>
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
              );
            })}
          </ul>
        </section>
      )}

      <footer className="landing-footer">
        <Link to="/moderator" className="landing-footer-link">
          Moderator
        </Link>
      </footer>
    </div>
  );
}

export default Landing;
