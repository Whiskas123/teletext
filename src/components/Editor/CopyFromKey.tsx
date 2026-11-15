/**
 * The key that copies another page onto this one.
 *
 * Asks which — `700`, or `700.2` for a subpage — in the same drawer
 * {@link ConfirmKey} asks its question in, and in place of the key in the
 * phone's page sheet for the same reason that one does.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useCopy } from '../Room/useCopy';

/** `700`, `700.2` or `700/2` as a page and a subpage; null for anything else. */
function parsePageRef(text: string): { pageNumber: number; subpage: number } | null {
  const match = /^\s*(\d{3})(?:[./](\d{1,2}))?\s*$/.exec(text);
  if (match == null) return null;
  return { pageNumber: Number(match[1]), subpage: Number(match[2] ?? 1) };
}

export function CopyFromKey({
  className = '',
  children,
  suggestion,
  onCopy,
  inline = false,
}: {
  className?: string;
  children: ReactNode;
  /** What the field starts with: the screen before this one, if there is one. */
  suggestion: string;
  /** Copies the page named; false when there is nothing there to copy. */
  onCopy: (pageNumber: number, subpage: number) => boolean;
  inline?: boolean;
}) {
  const copy = useCopy();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
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

  const form = (
    <form
      className="rc-confirm"
      onSubmit={(event) => {
        event.preventDefault();
        const ref = parsePageRef(text);
        if (ref != null && onCopy(ref.pageNumber, ref.subpage)) setAsking(false);
        else setMissing(true);
      }}
    >
      <label className="rc-confirm-question" htmlFor="copy-from-input">
        {copy.editor.copyFromHint}
      </label>
      <div className="rc-keyrow">
        <input
          id="copy-from-input"
          className="rc-field"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          placeholder="700"
          aria-invalid={missing}
          onChange={(event) => {
            setText(event.target.value);
            setMissing(false);
          }}
        />
        <button type="submit" className="rc-key">
          <span>{copy.editor.copyFromGo}</span>
        </button>
      </div>
      {missing && (
        <span className="rc-error" role="alert">
          {copy.editor.copyFromMissing}
        </span>
      )}
    </form>
  );

  if (inline && asking) return form;

  return (
    <div className="rc-anchor" ref={anchorRef}>
      <button
        type="button"
        className={className}
        onClick={() => {
          setText(suggestion);
          setMissing(false);
          setAsking((shown) => !shown);
        }}
        title={copy.editor.copyFromHint}
        aria-label={copy.editor.copyFromHint}
        aria-expanded={inline ? undefined : asking}
      >
        {children}
      </button>
      {asking && !inline && <div className="rc-flyout rc-flyout-end">{form}</div>}
    </div>
  );
}
