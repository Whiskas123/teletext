/**
 * The one line on `/manage` that says how an action went.
 *
 * Two things here are deliberate and were previously wrong.
 *
 * **The role follows the tone.** Every outcome used to be announced through
 * `role="status"`, so "Page 204 deleted." and a publish that failed were
 * indistinguishable to a screen reader. A failure interrupts; a success does
 * not.
 *
 * **Nothing disappears on a timer.** An operator who looked away has no way to
 * ask what happened, and a message that vanished is worse than no message at
 * all because it implies the screen already told them. It stays until something
 * newer replaces it or they dismiss it.
 */

import { forwardRef } from 'react';

import type { Notice } from '../../domain/manageMessages';

export interface NoticeAreaProps {
  notice: Notice | null;
  onDismiss(): void;
}

export const NoticeArea = forwardRef<HTMLDivElement, NoticeAreaProps>(
  function NoticeArea({ notice, onDismiss }, ref) {
    return (
      <div
        // Focusable without being a tab stop, so the shell can move focus here
        // when a confirmation's opening control no longer exists to return to.
        ref={ref}
        tabIndex={-1}
        className={
          notice == null
            ? 'manage-notice manage-notice-empty'
            : `manage-notice manage-notice-${notice.tone}`
        }
      >
        {/*
          * Both live regions are always present, and only the matching one is
          * filled. A region inserted at the same moment as its text is not
          * reliably announced — the tree has to be there first for the change
          * to be a change.
          */}
        <p className="manage-notice-text" role="status">
          {notice?.tone === 'status' ? notice.text : ''}
        </p>
        <p className="manage-notice-text" role="alert">
          {notice?.tone === 'alert' ? notice.text : ''}
        </p>
        {notice != null && (
          <button
            type="button"
            className="manage-mini-btn"
            onClick={onDismiss}
            aria-label="Dismiss message"
          >
            ×
          </button>
        )}
      </div>
    );
  },
);
