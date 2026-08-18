/**
 * useVoting — playhtml binding for the remote-control Change_Request / voting
 * flow (Requirement 4).
 *
 * A member proposes changing the room's displayed Page_Number; other members
 * vote to accept or reject before the change applies to everyone. This hook is a
 * thin wrapper: every decision (create, cast, tally, resolve) is delegated to
 * the pure, framework-free `src/domain/voting.ts` module so the behavior is
 * exhaustively property-tested (Properties 8-14) without a live server.
 *
 * ## Binding approach
 *
 * The active Change_Request lives in a single shared-state channel `"vote"`
 * ({@link VoteData}, default `{ active: null }`) bound via `usePageData`, which
 * returns a `useState`-like `[data, setData]` where `setData` accepts either a
 * next value or an immer-style `(draft) => void` mutator. Present member ids come
 * from {@link usePresence}; the accepted target is applied through
 * {@link useRoomSync}'s `setDisplayedPageDirect`.
 *
 * ## Deterministic resolution & expiry timing
 *
 * Resolution is a pure, idempotent function of the stored request, the present
 * members, and `now` (see the design's "Deterministic timeout resolution"
 * note). An effect re-evaluates {@link resolveChangeRequest} whenever the active
 * request or the present-member set changes (so vote-driven accept/reject
 * resolves promptly), and a 1-second interval re-evaluates it while a request is
 * active so that the 60s expiry (Req 4.9) is detected even when no further votes
 * arrive. Every write is guarded by `status === 'active'` ("first observer
 * writes"): once any client has written a terminal status the guard is false on
 * all clients, so redundant writes are skipped and the outcome converges via
 * Yjs last-writer-wins. On an accepted resolution the room's displayed page is
 * set to the target; on any resolution the active slot is cleared (Req 4.10).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePageData } from '@playhtml/react';

import {
  castVote,
  createChangeRequest,
  resolveChangeRequest,
  tally,
  type CastVoteResult,
  type CreateChangeRequestResult,
  type Tally,
  type VoteDecision,
} from '../domain/voting';
import { usePresence } from './usePresence';
import { useRoomSync } from './useRoomSync';
import { useRoomId } from './RoomContext';
import { getSessionMemberId } from './session';
import type { ChangeRequest, VoteData } from './types';

/** Base id for the vote channel; the effective channel is keyed per Room_ID. */
export const VOTE_CHANNEL_ID = 'vote';
/** Build the per-room vote channel id (`vote:${roomId}`). */
const voteChannel = (roomId: string): string => `${VOTE_CHANNEL_ID}:${roomId}`;

/** Default vote data for a room with no active Change_Request. */
const DEFAULT_VOTE_DATA: VoteData = { active: null };

/** How often (ms) the active request is re-checked so expiry is detected. */
const RESOLUTION_TICK_MS = 1_000;

/** Result of {@link VotingApi.submit} (delegates to `createChangeRequest`). */
export type SubmitResult = CreateChangeRequestResult;

/** Result of {@link VotingApi.vote} (delegates to `castVote`). */
export type VoteResult = CastVoteResult;

/**
 * Public voting API surface (see design.md "Shared-state hooks: useVoting").
 */
export interface VotingApi {
  /** The active Change_Request, or `null` when none is active. */
  active: ChangeRequest | null;
  /**
   * Submit a target Page_Number as a Change_Request.
   *
   * Returns `{ ok: true, changeRequest }` when created, or `{ ok: false,
   * reason }` when rejected — `'out-of-range'` (target not an integer 1..999,
   * Req 4.11) or `'active-exists'` (a request is already active, Req 4.2). On
   * rejection the existing state is left unchanged.
   */
  submit(target: number): SubmitResult;
  /**
   * Cast the local member's Vote on the active Change_Request. Returns `{ ok:
   * true, cr }` when recorded, or `{ ok: false, reason, cr }` when rejected
   * (`'not-active'`, `'ineligible'`, or `'already-voted'`). On rejection the
   * existing vote/state is retained.
   */
  vote(decision: VoteDecision): VoteResult;
  /** Live tally of the active request among still-present eligible members. */
  tally: Tally;
}

/** Empty tally surfaced when no Change_Request is active. */
const EMPTY_TALLY: Tally = { accept: 0, reject: 0, base: 0, threshold: 0 };

/**
 * Bind the room voting flow to shared state and expose submit / vote / tally,
 * driving deterministic, idempotent resolution and expiry.
 */
export function useVoting(): VotingApi {
  const roomId = useRoomId();
  const [data, setData] = usePageData<VoteData>(
    voteChannel(roomId),
    DEFAULT_VOTE_DATA,
  );
  const { members } = usePresence();
  const { setDisplayedPageDirect } = useRoomSync();

  const memberId = useMemo(() => getSessionMemberId(), []);

  const active = data?.active ?? null;

  // Present member ids, recomputed only when the membership actually changes so
  // it can be a stable effect dependency.
  const presentMemberIds = useMemo(
    () => members.map((m) => m.memberId),
    [members],
  );

  const submit = useCallback(
    (target: number): SubmitResult => {
      const result = createChangeRequest(
        data ?? DEFAULT_VOTE_DATA,
        target,
        memberId,
        presentMemberIds,
        Date.now(),
      );
      if (result.ok) {
        setData((draft) => {
          // Re-check under the write to avoid clobbering a concurrently-created
          // request (Req 4.2): only claim the slot when it is free.
          if (!draft.active || draft.active.status !== 'active') {
            draft.active = result.changeRequest;
          }
        });
      }
      return result;
    },
    [data, memberId, presentMemberIds, setData],
  );

  const vote = useCallback(
    (decision: VoteDecision): VoteResult => {
      const current = data?.active ?? null;
      if (!current) {
        // Synthesize a not-active rejection without a request to reference.
        return {
          ok: false,
          reason: 'not-active',
          cr: current as unknown as ChangeRequest,
        };
      }
      const result = castVote(current, memberId, decision);
      if (result.ok) {
        setData((draft) => {
          // Mutate the single vote key in place rather than reassigning the
          // whole active object: reassigning would try to re-insert the already
          // -integrated nested arrays (eligibleMemberIds) and throw. Only apply
          // while the same request is still active.
          if (draft.active && draft.active.status === 'active') {
            if (draft.active.votes == null) draft.active.votes = {};
            draft.active.votes[memberId] = decision;
          }
        });
      }
      return result;
    },
    [data, memberId, setData],
  );

  const currentTally = useMemo<Tally>(
    () => (active ? tally(active, presentMemberIds) : EMPTY_TALLY),
    [active, presentMemberIds],
  );

  // Deterministic, idempotent resolution. Runs whenever the active request or
  // the present-member set changes, and on a fixed interval so the 60s expiry
  // is detected even without new votes (Req 4.9). The `status === 'active'`
  // guard makes this "first observer writes": once resolved on any client the
  // guard is false everywhere and redundant writes are skipped, converging via
  // Yjs LWW (design's deterministic-timeout note).
  /*
   * Written from an effect, not during render.
   *
   * Declared here rather than beside the resolution effect below because effects
   * run in declaration order: this one has to have landed before that one calls
   * `resolveNow`, or the first resolution after a member joins or leaves would
   * be decided against the previous membership.
   */
  const presentRef = useRef(presentMemberIds);
  useEffect(() => {
    presentRef.current = presentMemberIds;
  }, [presentMemberIds]);

  const resolveNow = useCallback(() => {
    const current = data?.active ?? null;
    if (!current || current.status !== 'active') return;

    const resolution = resolveChangeRequest(
      current,
      presentRef.current,
      Date.now(),
    );
    if (resolution.status === 'active') return;

    // Apply the accepted target to the room's displayed page (Req 4.6).
    if (resolution.status === 'accepted' && resolution.target !== null) {
      setDisplayedPageDirect(resolution.target);
    }

    // Clear the active request (Req 4.10), guarded so only the first observer
    // writes and repeated writes are idempotent.
    setData((draft) => {
      if (draft.active && draft.active.status === 'active') {
        draft.active = null;
      }
    });
  }, [data, setData, setDisplayedPageDirect]);

  useEffect(() => {
    // Re-evaluate immediately on vote/presence changes.
    resolveNow();
    if (!active || active.status !== 'active') return;
    // And keep ticking so expiry is caught without further votes.
    const timer = setInterval(resolveNow, RESOLUTION_TICK_MS);
    return () => clearInterval(timer);
  }, [active, resolveNow]);

  return {
    active,
    submit,
    vote,
    tally: currentTally,
  };
}
