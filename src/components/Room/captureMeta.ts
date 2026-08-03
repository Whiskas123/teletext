/**
 * Reading a capture's metadata out loud.
 *
 * Small enough to have lived in the browser component, but it is shared with the
 * publish panel — both have to say why a capture cannot be published, and they
 * must not disagree about it.
 */

import type { CaptureSummary } from '../../collab/useArchiveAdmin';

/** Longest free-text term the capture search accepts. */
export const MAX_CAPTURE_QUERY = 100;

/** A short, human description of when a capture was on air. */
export function describeSpan(capture: CaptureSummary): string {
  const first = capture.first_seen?.slice(0, 10);
  const last = capture.last_seen?.slice(0, 10);
  if (first == null) return 'undated';
  if (last == null || last === first) return first;
  return `${first} → ${last}`;
}

/**
 * Why a capture cannot be published, or null when it can.
 *
 * An undecoded capture is catalogued and browsable — most of the SIC corpus is in
 * this state — but publishing it would put a blank page on air.
 */
export function blockedReason(capture: CaptureSummary): string | null {
  if (capture.decode_status === 'unsupported-profile') {
    return `No render profile for ${capture.width}x${capture.height}`;
  }
  if (capture.decode_status === 'failed') return 'Failed to decode';
  return null;
}
