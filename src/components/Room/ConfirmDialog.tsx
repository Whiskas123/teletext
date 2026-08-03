/**
 * Asking before something cannot be undone.
 *
 * `window.confirm` did this for delete and nothing did it for unpublish —
 * although unpublish also blanks the page's content and clears its title, so the
 * one that asked was not the only one worth asking about.
 *
 * ## Hand-rolled rather than `<dialog showModal>`
 *
 * jsdom implements modal dialogs only partly, so a native `<dialog>` would be
 * untestable exactly where it matters: the focus trap. With two known controls
 * the trap is four lines, and every part of it can be asserted. The native
 * element would be the better choice if the dialog ever grew a form.
 */

import { useEffect, useRef } from 'react';

import {
  confirmBody,
  confirmHeading,
  confirmLabel,
  type ConfirmRequest,
} from '../../domain/manageMessages';

export interface ConfirmDialogProps {
  request: ConfirmRequest;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ request, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const headingId = `confirm-${request.action}-${request.pageNumber}`;

  // Focus lands on the cancelling control, not the confirming one: a stray
  // Enter or Space arriving on a dialog nobody expected should do nothing.
  useEffect(() => {
    cancelRef.current?.focus();
  }, [request]);

  return (
    <div className="manage-confirm-backdrop">
      <div
        className="manage-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key !== 'Tab') return;

          // Two controls, so Tab and Shift+Tab both mean "the other one" —
          // which keeps focus inside without tracking where it currently is.
          event.preventDefault();
          const target =
            document.activeElement === confirmRef.current
              ? cancelRef.current
              : confirmRef.current;
          target?.focus();
        }}
      >
        <h2 className="manage-confirm-title" id={headingId}>
          {confirmHeading(request)}
        </h2>
        <p className="manage-confirm-body">{confirmBody(request)}</p>
        <div className="manage-confirm-actions">
          <button
            type="button"
            ref={cancelRef}
            className="manage-mini-btn"
            onClick={onCancel}
          >
            Keep the page
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="manage-mini-btn manage-mini-btn-danger"
            onClick={onConfirm}
          >
            {confirmLabel(request)}
          </button>
        </div>
      </div>
    </div>
  );
}
