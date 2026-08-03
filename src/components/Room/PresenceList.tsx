/**
 * PresenceList — renders the room's present members and member count.
 *
 * Design notes (see design.md "Presentation components" and Req 2):
 * - Reads member Identity and count from {@link usePresence} (awareness-backed).
 * - Displays each present member's display name alongside a color swatch drawn
 *   in that member's assigned Identity color (Req 2.3).
 * - Shows the live member count, which equals the number of members in the list
 *   and is clamped to the room capacity by the hook (Req 2.7).
 * - When no members are present, shows a "No members online" indication instead
 *   of an empty list (Req 2.8).
 * - Optionally exposes a small input to change the local member's display name
 *   via {@link PresenceApi.setDisplayName}; an inline error is shown when the
 *   submitted name is rejected as invalid (Req 2.5), preserving the previous
 *   name.
 *
 * Requirements: 2.2, 2.3, 2.7, 2.8.
 */

import { useState, type FormEvent } from 'react';

import { usePresence } from '../../collab/usePresence';

/**
 * The "No members online" indication text shown when the presence list is empty
 * (Req 2.8).
 */
export const NO_MEMBERS_LABEL = 'No members online';

/**
 * The inline error shown when a submitted display name is rejected (Req 2.5).
 */
export const INVALID_NAME_LABEL =
  'Display name must be between 1 and 32 characters';

export interface PresenceListProps {
  /**
   * When `true` (the default), render a small input that lets the local member
   * change their display name via `setDisplayName`. Set to `false` to render a
   * read-only presence list.
   */
  allowRename?: boolean;
}

/**
 * Render the room's presence list, member count, and an optional rename control.
 */
export function PresenceList({ allowRename = true }: PresenceListProps) {
  const { members, count, me, setDisplayName } = usePresence();

  const [draftName, setDraftName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const handleRename = (event: FormEvent) => {
    event.preventDefault();
    const result = setDisplayName(draftName);
    if (result === 'invalid') {
      // Reject and retain the previous name; surface an inline error (Req 2.5).
      // The form stays open, or the error would have nowhere to appear.
      setNameError(true);
      return;
    }
    setNameError(false);
    setDraftName('');
    // The job is done, so it folds away again.
    setRenameOpen(false);
  };

  return (
    <section className="presence-list" aria-label="Viewers present">
      <h2 className="sidebar-heading">
        Viewers <span className="presence-count">({count})</span>
      </h2>

      {members.length === 0 ? (
        <p className="presence-empty">{NO_MEMBERS_LABEL}</p>
      ) : (
        <ul className="presence-members">
          {members.map((member) => {
            const isMe = member.memberId === me.memberId;
            return (
              <li key={member.memberId} className="presence-member">
                <span
                  className="presence-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: member.color }}
                />
                <span className="presence-name">
                  {member.name}
                  {isMe ? ' (you)' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        * Collapsed by default. Renaming is a once-per-visit thing, and the
        * sidebar's job is to show who is here — a permanently open form pushed
        * the list of viewers up the panel for a control almost nobody was about
        * to use.
        */}
      {allowRename && (
        <>
          <button
            type="button"
            className="presence-rename-toggle"
            aria-expanded={renameOpen}
            aria-controls="presence-rename"
            onClick={() => {
              setRenameOpen((open) => !open);
              setNameError(false);
            }}
          >
            Change your name{renameOpen ? ' ▴' : ' ▾'}
          </button>
          {renameOpen && (
        <form className="presence-rename" id="presence-rename" onSubmit={handleRename}>
          <label className="sidebar-field-label" htmlFor="presence-name-input">
            Your name
          </label>
          <input
            id="presence-name-input"
            className="presence-name-input"
            type="text"
            value={draftName}
            placeholder={me.name}
            aria-invalid={nameError}
            aria-describedby={nameError ? 'presence-name-error' : undefined}
            onChange={(event) => {
              setDraftName(event.target.value);
              if (nameError) {
                setNameError(false);
              }
            }}
          />
          <button type="submit" className="sidebar-action-btn">
            Set name
          </button>
          {nameError && (
            <p
              id="presence-name-error"
              className="presence-name-error"
              role="alert"
            >
              {INVALID_NAME_LABEL}
            </p>
          )}
        </form>
          )}
        </>
      )}
    </section>
  );
}

export default PresenceList;
