/**
 * PresenceList — who else is in the room (Requirement 2).
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
 * ## Where it lives now
 *
 * It used to be a panel of its own, stacked above the chat down the side of the
 * room. Two panels saying who is here and what they are saying is one panel too
 * many: the names in the chat are the same names, and a standing column of them
 * pushed the conversation down the screen to no purpose. So it folds into the
 * head of the chat instead (see {@link ChatSidebar}) — a row of coloured chips
 * across the top of the log, wrapping as the room fills — and this component
 * lays itself out for that: a heading and its count, the roster, and a rename
 * control that stays folded away until it is wanted.
 *
 * Requirements: 2.2, 2.3, 2.7, 2.8.
 */

import { useState, type FormEvent } from 'react';

import { COPY } from '../../domain/copy';
import { DEFAULT_LANGUAGE } from '../../domain/landing';
import { usePresence } from '../../collab/usePresence';
import { useCopy } from './useCopy';

/**
 * The "No members online" indication text shown when the presence list is empty
 * (Req 2.8).
 */
export const NO_MEMBERS_LABEL = COPY[DEFAULT_LANGUAGE].presence.none;

/**
 * The inline error shown when a submitted display name is rejected (Req 2.5).
 */
export const INVALID_NAME_LABEL = COPY[DEFAULT_LANGUAGE].presence.invalidName;

export interface PresenceListProps {
  /**
   * When `true` (the default), render a small input that lets the local member
   * change their display name via `setDisplayName`. Set to `false` to render a
   * read-only presence list.
   */
  allowRename?: boolean;
}

/**
 * Render the room's presence roster, member count, and an optional rename
 * control.
 */
export function PresenceList({ allowRename = true }: PresenceListProps) {
  const { members, count, me, setDisplayName } = usePresence();
  const copy = useCopy();

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
    <section className="presence-list" aria-label={copy.presence.region}>
      <div className="presence-head">
        <h2 className="rc-legend presence-heading">
          {copy.presence.heading}{' '}
          <span className="presence-count">{copy.presence.count(count)}</span>
        </h2>

        {/*
          * Renaming is a once-per-visit thing and the roster is what the head is
          * for, so the control is a tool at the end of the line rather than a
          * form standing open under it — the same arrangement as the magnifier
          * on the directory's masthead.
          */}
        {allowRename && (
          <button
            type="button"
            className="rc-key-tool presence-rename-toggle"
            aria-expanded={renameOpen}
            aria-controls="presence-rename"
            onClick={() => {
              setRenameOpen((open) => !open);
              setNameError(false);
            }}
          >
            {copy.presence.rename}
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="presence-empty">{copy.presence.none}</p>
      ) : (
        <ul className="presence-members">
          {members.map((member) => {
            const isMe = member.memberId === me.memberId;
            return (
              <li
                key={member.memberId}
                className={`presence-member${isMe ? ' presence-member-me' : ''}`}
              >
                <span
                  className="presence-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: member.color }}
                />
                <span className="presence-name">
                  {member.name}
                  {isMe ? ` ${copy.presence.you}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {allowRename && renameOpen && (
        <form className="presence-rename" id="presence-rename" onSubmit={handleRename}>
          <input
            id="presence-name-input"
            className="rc-field presence-name-input"
            type="text"
            value={draftName}
            placeholder={me.name}
            aria-label={copy.presence.yourName}
            aria-invalid={nameError}
            aria-describedby={nameError ? 'presence-name-error' : undefined}
            onChange={(event) => {
              setDraftName(event.target.value);
              if (nameError) {
                setNameError(false);
              }
            }}
          />
          <button type="submit" className="rc-key presence-rename-btn">
            {copy.presence.save}
          </button>
          {nameError && (
            <p id="presence-name-error" className="rc-note presence-name-error" role="alert">
              {copy.presence.invalidName}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export default PresenceList;
