/**
 * A key that asks before it acts.
 *
 * For the two presses on the panel that destroy something — clearing the page,
 * removing a subpage. On a desk the question hangs off the key as a small
 * drawer, and a press anywhere else or Escape is "no". In the page sheet on a
 * phone it replaces the key in place instead: a drawer hanging off a key near
 * the bottom of a scrolling sheet is a drawer cut in half, and a stray tap
 * should not be the thing that answers.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ConfirmKey({
  className = '',
  children,
  title,
  question,
  yes,
  no,
  onConfirm,
  disabled = false,
  inline = false,
  align = 'start',
}: {
  className?: string;
  /** What is printed on the key. */
  children: ReactNode;
  /** The key's tooltip and accessible name. */
  title: string;
  question: string;
  yes: string;
  no: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Ask in place of the key rather than in a drawer under it. */
  inline?: boolean;
  align?: 'start' | 'end';
}) {
  const [asking, setAsking] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!asking || inline) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setAsking(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAsking(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [asking, inline]);

  const answer = (
    <div className="rc-confirm" role="alertdialog" aria-label={question}>
      <span className="rc-confirm-question">{question}</span>
      <div className="rc-keyrow">
        <button
          type="button"
          className="rc-key rc-key-danger"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          <span>{yes}</span>
        </button>
        <button type="button" className="rc-key" onClick={() => setAsking(false)}>
          <span>{no}</span>
        </button>
      </div>
    </div>
  );

  if (inline && asking) return answer;

  return (
    <div className="rc-anchor" ref={anchorRef}>
      <button
        type="button"
        className={className}
        onClick={() => setAsking((shown) => !shown)}
        title={title}
        aria-label={title}
        aria-expanded={inline ? undefined : asking}
        disabled={disabled}
      >
        {children}
      </button>
      {asking && !inline && (
        <div className={`rc-flyout${align === 'end' ? ' rc-flyout-end' : ''}`}>
          {answer}
        </div>
      )}
    </div>
  );
}
