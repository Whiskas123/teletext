/**
 * What is being dragged on `/manage`.
 *
 * Held here rather than in `dataTransfer`, because the browser hides a drag's
 * data until the drop — and the list has to know *during* the drag whether it
 * is pages or captures, to say what a drop would do. Custom MIME types in
 * `dataTransfer.types` would answer that too, but Safari has been unreliable
 * about them. Both ends of every drag are on this one page, so a module value
 * is all the channel needed. `text/plain` is still set, because Firefox will
 * not start a drag without some data.
 */

import type { DragEvent } from 'react';

export type DragPayload =
  | { kind: 'pages'; pages: number[] }
  | { kind: 'captures'; ids: number[] };

let current: DragPayload | null = null;

export function beginDrag(event: DragEvent, payload: DragPayload, label: string): void {
  current = payload;
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('text/plain', label);
}

export function currentDrag(): DragPayload | null {
  return current;
}

export function endDrag(): void {
  current = null;
}
