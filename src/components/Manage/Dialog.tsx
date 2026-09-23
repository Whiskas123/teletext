/**
 * A modal dialog, and the confirmation built on it.
 *
 * Hand-rolled rather than `<dialog showModal>` because jsdom implements modal
 * dialogs only partly, and the focus trap is exactly the part worth testing.
 * Focus goes in on open (to the element marked `data-autofocus`, else the
 * first control), Tab cycles inside, Escape cancels, and focus goes back to
 * whatever opened it — or, if that went with a deleted page, to the list.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Buttons along the bottom. */
  footer: ReactNode;
  wide?: boolean;
}

export function Dialog({ title, onClose, children, footer, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (opener != null && document.contains(opener)) opener.focus();
      else document.querySelector<HTMLElement>('.mg-table')?.focus();
    };
  }, []);

  return (
    <div
      className="mg-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`mg-dialog${wide ? ' mg-dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (items.length === 0) return;
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey
            ? index <= 0
              ? items[items.length - 1]
              : items[index - 1]
            : index === items.length - 1
              ? items[0]
              : items[index + 1];
          event.preventDefault();
          next.focus();
        }}
      >
        <h2 className="mg-dialog-title" id={headingId}>
          {title}
        </h2>
        <div className="mg-dialog-body">{children}</div>
        <div className="mg-dialog-footer">{footer}</div>
      </div>
    </div>
  );
}

/** A question with one irreversible answer. */
export interface ConfirmSpec {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Red, for something that cannot be undone from here. */
  danger?: boolean;
  onConfirm(): void;
}

export function ConfirmDialog({
  spec,
  onClose,
}: {
  spec: ConfirmSpec;
  onClose(): void;
}) {
  return (
    <Dialog
      title={spec.title}
      onClose={onClose}
      footer={
        <>
          {/* Focus starts on Cancel: a stray Enter on a dialog nobody expected
              should do nothing. */}
          <button type="button" className="mg-btn" data-autofocus onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`mg-btn ${spec.danger ? 'mg-btn-danger' : 'mg-btn-primary'}`}
            onClick={() => {
              onClose();
              spec.onConfirm();
            }}
          >
            {spec.confirmLabel}
          </button>
        </>
      }
    >
      {spec.body}
    </Dialog>
  );
}
