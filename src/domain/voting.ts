/**
 * Voting domain logic for Collaborative Teletext Rooms.
 *
 * A member proposes changing the room's displayed Page_Number through a
 * Change_Request that other members vote on. This module is the pure,
 * framework-free heart of that flow: it computes the accept threshold, creates
 * change requests, records votes, tallies them, and resolves a request as
 * accepted / rejected / expired. Keeping it free of React and playhtml lets it
 * be exhaustively property-tested (Properties 8-14) without a live server.
 *
 * All functions are deterministic: the current time is always passed in as
 * `now` (no `Date.now()` inside), and resolution is a pure, idempotent function
 * of the stored Change_Request (`createdAt`, `voteBase`, `votes`) plus the
 * present-member set. This lets multiple clients converge on the same
 * resolution via last-writer-wins (see the design's deterministic-timeout
 * note).
 *
 * The `Vote`, `ChangeRequest`, and `VoteData` shapes are reused from
 * `src/collab/types.ts`; page-range validation is reused from
 * `src/domain/pageOps.ts`.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_
 */

import type { ChangeRequest, VoteData } from '../collab/types';
import { inPageRange } from './pageOps';

/** A member's decision on a Change_Request. */
export type VoteDecision = 'accept' | 'reject';

/** How long after creation a Change_Request expires, in milliseconds (Req 4.9). */
export const CHANGE_REQUEST_TTL_MS = 60_000;

/**
 * The number of accept Votes required to accept a Change_Request: a strict
 * majority of the Vote_Base, defined as `floor(base / 2) + 1`.
 *
 * For any `base >= 1` this satisfies `2 * acceptThreshold(base) > base`, i.e. it
 * is always a strict majority.
 *
 * _Requirements: 4.6_ — Property 8.
 */
export function acceptThreshold(base: number): number {
  return Math.floor(base / 2) + 1;
}

/** Reasons a {@link createChangeRequest} submission can be rejected. */
export type CreateRejectReason =
  /** Target Page_Number is not an integer in 1..999 (Req 4.11). */
  | 'out-of-range'
  /** An active Change_Request already exists (Req 4.2). */
  | 'active-exists';

/** Discriminated result of {@link createChangeRequest}. */
export type CreateChangeRequestResult =
  | { ok: true; changeRequest: ChangeRequest }
  | { ok: false; reason: CreateRejectReason };

/** Return the members of `ids` with duplicates removed, order preserved. */
function unique(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Create a new active Change_Request, or reject the submission.
 *
 * The submission is rejected when the `target` is not an integer within the
 * inclusive range 1..999 (Req 4.11) or when an active Change_Request already
 * exists in `state` (Req 4.2); in both cases no Change_Request is created and
 * the caller should retain any existing active request.
 *
 * On success the returned Change_Request records the count of present members as
 * a fixed `voteBase`, the present member ids as the fixed `eligibleMemberIds`,
 * `createdAt = now`, status `'active'`, and exactly one implicit accept Vote
 * attributed to `requesterId` (Req 4.1). The id is derived deterministically
 * from the requester, target, and `now` so the function stays pure.
 *
 * _Requirements: 4.1, 4.2, 4.11_ — Properties 9, 10, 14.
 */
export function createChangeRequest(
  state: VoteData,
  target: number,
  requesterId: string,
  presentMemberIds: readonly string[],
  now: number,
): CreateChangeRequestResult {
  if (!inPageRange(target)) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (state && state.active && state.active.status === 'active') {
    return { ok: false, reason: 'active-exists' };
  }

  // Eligible members are exactly those present at creation. The requester is
  // present by definition, so ensure they are included even if the caller
  // omitted them, keeping the implicit vote attributable to an eligible member.
  const eligibleMemberIds = unique(presentMemberIds);
  if (!eligibleMemberIds.includes(requesterId)) {
    eligibleMemberIds.push(requesterId);
  }

  const changeRequest: ChangeRequest = {
    id: `${requesterId}:${target}:${now}`,
    target,
    requesterId,
    voteBase: eligibleMemberIds.length,
    eligibleMemberIds,
    votes: { [requesterId]: 'accept' },
    createdAt: now,
    status: 'active',
  };

  return { ok: true, changeRequest };
}

/** Reasons a {@link castVote} can be rejected. */
export type CastVoteRejectReason =
  /** The Change_Request is not active (already resolved). */
  | 'not-active'
  /** The member was not present at creation (late joiner / ineligible). */
  | 'ineligible'
  /** The member has already cast a Vote (Req 4.4). */
  | 'already-voted';

/**
 * Discriminated result of {@link castVote}. The updated Change_Request is
 * always returned: on rejection it is the (unchanged) input request so callers
 * retain the existing state.
 */
export type CastVoteResult =
  | { ok: true; cr: ChangeRequest }
  | { ok: false; reason: CastVoteRejectReason; cr: ChangeRequest };

/**
 * Record a member's Vote on an active Change_Request.
 *
 * Each eligible member may cast exactly one Vote. The Vote is rejected (and the
 * existing request retained unchanged) when the request is not active, when the
 * member was not present at creation (a late joiner is ineligible, Req 4.8),
 * or when the member has already voted (Req 4.4 — the original Vote is
 * retained). On success a new Change_Request is returned with the Vote recorded;
 * the input is never mutated. Only votes from eligible members are ever stored.
 *
 * _Requirements: 4.3, 4.4, 4.8_ — Property 11.
 */
export function castVote(
  cr: ChangeRequest,
  memberId: string,
  decision: VoteDecision,
): CastVoteResult {
  if (cr.status !== 'active') {
    return { ok: false, reason: 'not-active', cr };
  }
  if (!cr.eligibleMemberIds.includes(memberId)) {
    return { ok: false, reason: 'ineligible', cr };
  }
  if (Object.prototype.hasOwnProperty.call(cr.votes, memberId)) {
    return { ok: false, reason: 'already-voted', cr };
  }

  const updated: ChangeRequest = {
    ...cr,
    votes: { ...cr.votes, [memberId]: decision },
  };
  return { ok: true, cr: updated };
}

/** The counted state of a Change_Request. */
export interface Tally {
  /** Accept Votes among eligible members still present. */
  accept: number;
  /** Reject Votes among eligible members still present. */
  reject: number;
  /** The fixed Vote_Base recorded at creation. */
  base: number;
  /** The Accept_Threshold for the Vote_Base. */
  threshold: number;
}

/**
 * Tally the Votes on a Change_Request among eligible members who are still
 * present, discounting any Vote attributed to a member who has left the room
 * (Req 4.8). Also reports the fixed `base` and the derived `threshold`.
 *
 * _Requirements: 4.5, 4.8_ — Property 12.
 */
export function tally(
  cr: ChangeRequest,
  presentMemberIds: readonly string[],
): Tally {
  const present = new Set(presentMemberIds);
  const eligible = new Set(cr.eligibleMemberIds);
  let accept = 0;
  let reject = 0;
  for (const [memberId, decision] of Object.entries(cr.votes)) {
    // Votes are only ever stored for eligible members, but guard anyway; then
    // discount members who have since left the room.
    if (!eligible.has(memberId) || !present.has(memberId)) continue;
    if (decision === 'accept') accept += 1;
    else reject += 1;
  }
  return {
    accept,
    reject,
    base: cr.voteBase,
    threshold: acceptThreshold(cr.voteBase),
  };
}

/** The outcome of resolving a Change_Request. */
export type ResolutionStatus = 'active' | 'accepted' | 'rejected' | 'expired';

/**
 * The result of {@link resolveChangeRequest}.
 *
 * `cr` is the Change_Request with its `status` field updated to match
 * `status`. `active` is the value the shared `VoteData.active` slot should take:
 * `null` once resolved (clearing the active request so a new one may be
 * submitted, Req 4.10) or the still-active request while unresolved. `target`
 * is the Page_Number to display, present only when `status === 'accepted'`
 * (Req 4.6), and `null` otherwise.
 */
export interface Resolution {
  status: ResolutionStatus;
  cr: ChangeRequest;
  active: ChangeRequest | null;
  target: number | null;
}

/**
 * Resolve a Change_Request as a pure, idempotent function of its stored state,
 * the present-member set, and the current time `now`.
 *
 * Resolution order:
 * 1. **accepted** — accept Votes `>= acceptThreshold(voteBase)` (Req 4.6); the
 *    room's displayed page is set to the target.
 * 2. **rejected** — accept Votes plus the still-present eligible members who
 *    have not yet voted is below the threshold, so the target can no longer be
 *    reached (Req 4.7); the current page is retained.
 * 3. **expired** — at least {@link CHANGE_REQUEST_TTL_MS} (60s) have elapsed
 *    since `createdAt` without an accept/reject resolution (Req 4.9); the
 *    current page is retained.
 * 4. Otherwise the request remains **active**.
 *
 * When resolved to any terminal state the active request is cleared (Req 4.10).
 * The function is idempotent: an already-resolved request re-resolves to the
 * same terminal status with a cleared active slot, so repeated writes from
 * multiple clients converge (design's deterministic-timeout note).
 *
 * _Requirements: 4.6, 4.7, 4.9, 4.10_ — Property 13.
 */
export function resolveChangeRequest(
  cr: ChangeRequest,
  presentMemberIds: readonly string[],
  now: number,
): Resolution {
  // Idempotent short-circuit: a request already resolved stays resolved.
  if (cr.status !== 'active') {
    return {
      status: cr.status,
      cr,
      active: null,
      target: cr.status === 'accepted' ? cr.target : null,
    };
  }

  const { accept, threshold } = tally(cr, presentMemberIds);

  // 1. Accepted: enough accept votes to reach a strict majority of the base.
  if (accept >= threshold) {
    return {
      status: 'accepted',
      cr: { ...cr, status: 'accepted' },
      active: null,
      target: cr.target,
    };
  }

  // 2. Rejected: even if every still-present eligible member who has not yet
  // voted were to accept, the threshold could not be reached.
  const present = new Set(presentMemberIds);
  const eligible = new Set(cr.eligibleMemberIds);
  let presentEligibleNotYetVoted = 0;
  for (const memberId of eligible) {
    if (!present.has(memberId)) continue;
    if (!Object.prototype.hasOwnProperty.call(cr.votes, memberId)) {
      presentEligibleNotYetVoted += 1;
    }
  }
  if (accept + presentEligibleNotYetVoted < threshold) {
    return {
      status: 'rejected',
      cr: { ...cr, status: 'rejected' },
      active: null,
      target: null,
    };
  }

  // 3. Expired: the TTL has elapsed without an accept/reject resolution.
  if (now - cr.createdAt >= CHANGE_REQUEST_TTL_MS) {
    return {
      status: 'expired',
      cr: { ...cr, status: 'expired' },
      active: null,
      target: null,
    };
  }

  // 4. Still active.
  return { status: 'active', cr, active: cr, target: null };
}
