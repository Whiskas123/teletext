# Implementation Plan: Collaborative Teletext Rooms

## Overview

This plan re-architects the existing React 19 + TypeScript + Vite app (Bun for
scripts) into a real-time collaborative application backed by playhtml. Work is
ordered to validate correctness early: pure, framework-free domain logic in
`src/domain` is built and property-tested first (fast-check + Vitest), then the
playhtml binding hooks/providers in `src/collab`, then the presentation
components, then the removal of the `api/` layer and `redis`, and finally the
routing/wiring that ties everything together.

Each task builds on the previous one, ends by integrating into the app, and
leaves no orphaned code. All 22 correctness properties from the design map to
exactly one property-based test task, tagged with their property number.

## Tasks

- [x] 1. Project setup, tooling, and shared collaborative types
  - [x] 1.1 Add dependencies and configure the Bun-run test runner
    - Add `playhtml` and `@playhtml/react` to `dependencies`
    - Add `vitest` and `fast-check` to `devDependencies`
    - Create `vitest.config.ts` (or extend `vite.config.ts`) with the jsdom/node test environment and a global test setup
    - Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts so tests run via `bun run test` (single-run mode)
    - Verify `bun install` succeeds and `bun run test` executes with zero tests
    - _Requirements: 6.1, 7.1_

  - [x] 1.2 Define shared collaborative data-model types
    - Create `src/collab/types.ts` with `PageCellMap` (`Record<number, Cell>`), `RoomSyncData`, `PagesData`, `TitlesData`, `ChatMessage`, `ChatData`, `Vote`, `ChangeRequest`, `VoteData`, and `MemberPresence`
    - Reuse `Cell`, `TeletextPage`, `TeletextColor`, and `TOTAL_CELLS` from `src/types/teletext.ts`
    - Export a fixed `ROOM_COLOR_PALETTE` derived from the non-black `TELETEXT_COLORS` plus additional distinct hues, and a `ROOM_MAX_MEMBERS` capacity constant
    - _Requirements: 2.1, 4.1, 5.3, 6.1, 7.1, 9.1_

- [x] 2. Room identity domain: Room_ID and Member Identity
  - [x] 2.1 Implement `src/domain/roomId.ts`
    - `validateRoomId(id): boolean` — true iff length 1..64 and only letters, digits, hyphens
    - `generateRoomId(existing: Set<string> | string[]): string` — length 8..64, valid charset, not in `existing`
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x]* 2.2 Write property test for Room_ID validation
    - **Property 1: Room_ID validation is exactly charset + length bounded**
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [x]* 2.3 Write property test for Room_ID generation
    - **Property 2: Generated Room_IDs are always valid and collision-free**
    - **Validates: Requirements 1.2**

  - [x] 2.4 Implement `src/domain/identity.ts`
    - `validateDisplayName(name): boolean` — true iff length 1..32; helper to retain previous name on rejection
    - `defaultDisplayName(seed): string` (e.g. `Guest-XXXX`, always 1..32 chars) and `assignColor(index)` from `ROOM_COLOR_PALETTE`
    - `presenceCount(members): number` — clamped to 0..`ROOM_MAX_MEMBERS`
    - _Requirements: 2.1, 2.5, 2.7_

  - [x]* 2.5 Write property test for display name validation
    - **Property 3: Display name validation is exactly length bounded**
    - **Validates: Requirements 2.1, 2.5**

  - [x]* 2.6 Write property test for presence count
    - **Property 4: Presence count matches the member list**
    - **Validates: Requirements 2.7**

- [x] 3. Page operations domain
  - [x] 3.1 Implement `src/domain/pageOps.ts`
    - `normalizePage(raw): TeletextPage` — always exactly 960 valid cells; missing/malformed cells become empty cells; identity on already-valid pages
    - `isNonEmptyPage(page): boolean`, `inPageRange(n): boolean` (integer 1..999)
    - `nextNonEmptyPage(cur, pages): number | null` and `prevNonEmptyPage(cur, pages): number | null` with wrap and null when no other non-empty page exists
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 7.4, 7.7_

  - [x]* 3.2 Write property test for page normalization
    - **Property 20: Page normalization always yields 960 valid cells and is identity on valid pages**
    - **Validates: Requirements 7.4, 7.7**

  - [x]* 3.3 Write property test for displayed-page range validation
    - **Property 5: Displayed page changes are range-validated**
    - **Validates: Requirements 3.5**

  - [x]* 3.4 Write property test for next/previous navigation
    - **Property 6: Next/previous navigation skips empty pages and wraps**
    - **Validates: Requirements 3.6, 3.7, 3.8**

- [x] 4. CRDT merge model domain
  - [x] 4.1 Implement `src/domain/crdtModel.ts`
    - Model a cell-indexed map merge with per-key last-writer-wins (Lamport-style timestamp + client tie-break) mirroring `Y.Map` semantics
    - Provide an ordered-operation reducer that applies a fixed sequence of displayed-page changes and returns the converged value for every replica
    - _Requirements: 3.9, 6.2, 6.3, 8.5, 9.12_

  - [x]* 4.2 Write property test for ordered page-change convergence
    - **Property 7: Ordered page changes converge to the last applied value**
    - **Validates: Requirements 3.9**

- [x] 5. Cell edit domain
  - [x] 5.1 Implement `src/domain/cellEdit.ts`
    - `isValidCell(cell): boolean` — `char`, `fg`, `bg` defined and `graphics` unset or within 0..63
    - `applyCellEdit(page, index, cell): TeletextPage` — no-op on invalid cell; preserves 960-cell size and all other cells
    - _Requirements: 6.1, 6.4, 6.5, 6.7_

  - [x]* 5.2 Write property test for cell edit validation
    - **Property 17: Cell edit validation rejects malformed cells as a no-op**
    - **Validates: Requirements 6.7**

  - [x]* 5.3 Write property test for cell edit size/other-cell preservation
    - **Property 18: A cell edit preserves size and all other cells**
    - **Validates: Requirements 6.1, 6.4, 6.5**

  - [x]* 5.4 Write property test for concurrent-edit convergence
    - Uses the `crdtModel` cell-map merge from task 4.1
    - **Property 19: Concurrent edits converge deterministically (cell-level CRDT)**
    - **Validates: Requirements 6.2, 6.3, 8.5, 9.12**

- [x] 6. Voting domain
  - [x] 6.1 Implement `src/domain/voting.ts`
    - `acceptThreshold(base): number` = `floor(base / 2) + 1`
    - `createChangeRequest(state, target, requesterId, presentMemberIds, now)` — rejects when target out of 1..999 or an active request exists; otherwise records fixed `voteBase`, `eligibleMemberIds`, and requester implicit accept vote
    - `castVote(cr, memberId, decision)` — one vote per eligible member; rejects duplicates and ineligible/late joiners; discards votes from departed members
    - `tally(cr, presentMemberIds)` and `resolveChangeRequest(cr, presentMemberIds, now)` returning `accepted` / `rejected` / `expired` and clearing the active request
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [x]* 6.2 Write property test for accept threshold
    - **Property 8: Accept threshold is a strict majority**
    - **Validates: Requirements 4.6**

  - [x]* 6.3 Write property test for change-request submission
    - **Property 9: Submitting a change request captures base and requester vote**
    - **Validates: Requirements 4.1**

  - [x]* 6.4 Write property test for single active request
    - **Property 10: At most one active change request**
    - **Validates: Requirements 4.2**

  - [x]* 6.5 Write property test for vote eligibility and base fixing
    - **Property 11: One vote per eligible member, base fixed, eligibility enforced**
    - **Validates: Requirements 4.3, 4.4, 4.8**

  - [x]* 6.6 Write property test for vote tally
    - **Property 12: Vote tally equals recorded votes**
    - **Validates: Requirements 4.5**

  - [x]* 6.7 Write property test for change-request resolution
    - **Property 13: Change request resolution is correct and clears the active request**
    - **Validates: Requirements 4.6, 4.7, 4.9, 4.10**

  - [x]* 6.8 Write property test for target range validation
    - **Property 14: Change request target is range-validated**
    - **Validates: Requirements 4.11**

- [x] 7. Chat domain
  - [x] 7.1 Implement `src/domain/chat.ts`
    - `validateChatMessage(raw)` — accepts iff trimmed length 1..500, returns trimmed value; rejects empty/whitespace-only and over-length
    - `appendMessage(chat, text, author, ts)` — appends one attributed `ChatMessage`, keeping messages ordered ascending by timestamp
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7_

  - [x]* 7.2 Write property test for chat message validation
    - **Property 15: Chat message validation is exactly trimmed-length bounded**
    - **Validates: Requirements 5.3, 5.5, 5.6**

  - [x]* 7.3 Write property test for message append ordering
    - **Property 16: Sending appends one attributed message in chronological order**
    - **Validates: Requirements 5.1, 5.3, 5.7**

- [x] 8. Titles and TV Guide domain
  - [x] 8.1 Implement `src/domain/titles.ts`
    - `validateTitle(raw)` — accepts iff trimmed length 0..60, returns trimmed value; whitespace-only/empty yields length-0 title; over-60 rejected retaining current title
    - _Requirements: 9.2, 9.4, 9.6_

  - [x]* 8.2 Write property test for title validation
    - **Property 21: Title validation trims and is length bounded with empty default**
    - **Validates: Requirements 9.2, 9.4, 9.6**

  - [x] 8.3 Implement `src/domain/guide.ts`
    - `guideEntries(pages, titles): GuideEntry[]` — exactly the Page_Numbers that are Non_Empty_Page or have a title of length >= 1, each with its current title, ordered strictly ascending by Page_Number; empty when none qualify
    - _Requirements: 9.7, 9.11, 9.13_

  - [x]* 8.4 Write property test for guide listing
    - **Property 22: Guide listing has exactly the qualifying entries in ascending order**
    - **Validates: Requirements 9.7, 9.11, 9.13**

- [x] 9. Checkpoint - domain logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. playhtml providers and shared-state binding hooks
  - [x] 10.1 Implement `RoomProvider` in `src/collab/RoomProvider.tsx`
    - Wrap `PlayProvider` with `key={roomId}`, `initOptions={{ room: roomId, cursors: { enabled: true, room: roomId, container } }}`, and the current `pathname`
    - Accept an already-validated `roomId`; render nothing collaborative for invalid IDs
    - _Requirements: 1.4, 7.1_

  - [x] 10.2 Implement `useConnection` hook in `src/collab/useConnection.ts`
    - Expose `status: 'connected' | 'disconnected'`; retain last page while disconnected; re-sync and re-apply buffered edits on reconnect via the cell-map writes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 10.3 Implement `usePresence` hook in `src/collab/usePresence.ts`
    - Back Identity with awareness using `src/domain/identity.ts`; assign default name + palette color on connect; expose `members`, `me`, `count`, and `setDisplayName`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 10.4 Implement `useRoomSync` hook in `src/collab/useRoomSync.ts`
    - Bind `room-sync` shared state (default page 100) and the `pages` map; expose normalized `page`, `setDisplayedPage`, `gotoNextNonEmpty`, `gotoPrevNonEmpty` delegating to `src/domain/pageOps.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 7.4_

  - [x] 10.5 Implement `useVoting` hook in `src/collab/useVoting.ts`
    - Bind `vote` shared state; delegate `submit`, `vote`, resolution, and expiry to `src/domain/voting.ts`; on accepted resolution set the room displayed page; use first-observer-writes guarded by `status === 'active'`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [x] 10.6 Implement `useChat` hook in `src/collab/useChat.ts`
    - Bind `chat` shared state; expose chronological `messages` and `send` delegating to `src/domain/chat.ts`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 10.7 Implement `useEditPage` hook in `src/collab/useEditPage.ts`
    - Bind the per-page `PageCellMap`; expose normalized `page`, `editCell` (delegating to `src/domain/cellEdit.ts`), awareness-backed `setCursor`/`remoteCursors`, and `saveError`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 7.2, 7.3, 7.8, 7.9_

  - [x] 10.8 Implement `useGuide` hook in `src/collab/useGuide.ts`
    - Bind `titles` shared state; expose `entries` (via `src/domain/guide.ts`), `title`, `setTitle` (via `src/domain/titles.ts`), and `selectEntry` that routes through `useVoting().submit` rather than setting the page directly
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.10, 9.12_

  - [x]* 10.9 Write integration tests for sync, presence, and propagation
    - Two simulated clients over a playhtml/Yjs test harness
    - Cover presence add/update/remove, page/message/title propagation, cursor propagation/removal, and connection/reconnect
    - _Requirements: 2.2, 2.4, 2.6, 3.2, 3.3, 5.4, 6.6, 6.8, 7.3, 7.8, 8.1, 8.2, 8.3, 8.4, 9.5_

- [x] 11. Checkpoint - collaborative bindings complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Room entry, shell, and presence UI
  - [x] 12.1 Implement `RoomEntry` in `src/components/Room/RoomEntry.tsx`
    - Create-room control (uses `generateRoomId`) and join-room control (uses `validateRoomId`); preserve entered value and show a validation message on invalid input
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 12.2 Implement `RoomLayout` in `src/components/Room/RoomLayout.tsx`
    - Arrange viewer/editor, chat sidebar, presence list, vote panel, guide toggle, connection indicator, and the Room_ID display with a clipboard-copy control plus confirmation
    - _Requirements: 1.6_

  - [x] 12.3 Implement `PresenceList` and `ConnectionStatus` in `src/components/Room/`
    - `PresenceList` renders each member's name and color, shows the count, and a "No members online" indication when empty
    - `ConnectionStatus` shows/hides the disconnected indicator from `useConnection`
    - _Requirements: 2.2, 2.3, 2.7, 2.8, 8.1, 8.2_

  - [x]* 12.4 Write unit tests for entry, presence, and connection UI
    - Entry controls (1.1), clipboard copy confirmation (1.6), presence rendering + empty state (2.3, 2.8)
    - _Requirements: 1.1, 1.6, 2.3, 2.8_

- [x] 13. Viewer, editor, and collaborative content UI
  - [x] 13.1 Refactor `Editor` to accept an injected page and `editCell` callback
    - Update `src/components/Editor/Editor.tsx` so it can be driven by either local state (unchanged single-page use) or a collab hook, without changing `TeletextGrid`
    - _Requirements: 6.1, 6.5_

  - [x] 13.2 Implement `RoomViewer` in `src/components/Room/RoomViewer.tsx`
    - Reuse `TeletextGrid`; read displayed page from `useRoomSync`; next/prev controls; open the TV Guide without changing the displayed page
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.9_

  - [x] 13.3 Implement `RoomEditor` in `src/components/Room/RoomEditor.tsx`
    - Drive the refactored `Editor` via `useEditPage`; render remote cursors by Identity color; include the editable Page_Title field via `useGuide`
    - _Requirements: 6.1, 6.6, 6.8, 9.3_

  - [x] 13.4 Implement `ChatSidebar` in `src/components/Room/ChatSidebar.tsx`
    - Render chronological messages with author + timestamp; empty-chat indication; input wired to `useChat().send` with inline error on rejection
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [x] 13.5 Implement `VotePanel` / remote control in `src/components/Room/VotePanel.tsx`
    - Submit a target page as a Change_Request; render the live tally; accept/reject controls; disable submit while a request is active
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 13.6 Implement `TVGuide` in `src/components/Room/TVGuide.tsx`
    - List qualifying Guide_Entries ascending; "No title" indication for empty titles; empty-guide indication; selecting an entry routes through voting; leaves the displayed page unchanged
    - _Requirements: 9.7, 9.8, 9.9, 9.10, 9.11_

  - [x]* 13.7 Write unit tests for content UI states
    - Default page 100 (3.4), empty-chat indication (5.2), editor title field (9.3), "No title" rendering (9.8), guide-open no-op on displayed page (9.9), guide selection routes through voting (9.10)
    - _Requirements: 3.4, 5.2, 9.3, 9.8, 9.9, 9.10_

- [x] 14. Routing, migration, and cleanup
  - [x] 14.1 Wire routing and room shell into the app
    - Update `src/App.tsx`/`src/main.tsx`: `/` -> `RoomEntry`; `/room/:roomId` -> `RoomViewer` inside `RoomProvider`; `/room/:roomId/edit/:pageNumber` -> `RoomEditor` inside `RoomProvider`; validate Room_ID before mounting `RoomProvider`; add legacy redirect helpers for `/view` and `/edit/:n`
    - _Requirements: 1.1, 1.4, 1.5, 3.1_

  - [x] 14.2 Remove the serverless API layer and drop `/api` rewrites
    - Delete `api/pages/[number].ts`, `api/pages/index.ts`, `api/store.ts`, `api/validate.ts`, `api/seed-pages.ts`; remove `/api` rewrites from `vercel.json`; remove any `fetch('/api/pages')` calls from the client
    - _Requirements: 7.5, 7.6_

  - [x] 14.3 Remove API-tied dependencies from `package.json`
    - Remove `redis`, `@vercel/node`, and API-only `lz-string`/`@types/lz-string`; run `bun install` and confirm typecheck succeeds
    - _Requirements: 7.6_

  - [x]* 14.4 Write migration smoke/static tests
    - Assert no `fetch('/api/pages')` remains in the client, the `api/` directory is gone, and `redis` is absent from `package.json`
    - _Requirements: 7.5, 7.6_

  - [x] 14.5 One-time import of seed pages into the store
    - Migrate `.teletext-pages/page-100.json` and `page-200.json` into the Playhtml_Store cell-map format on first load so existing pages remain available
    - _Requirements: 7.1_

- [x] 15. Final checkpoint - build and verify
  - Run `bun run build` and `bun run test`; ensure the app builds and all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP; core implementation tasks are never optional.
- Each task references specific requirements for traceability.
- All 22 correctness properties map to exactly one property-based test task,
  tagged with the property number and the requirement clauses it validates.
- Property tests use fast-check + Vitest and run a minimum of 100 iterations.
- Checkpoints ensure incremental validation at natural integration boundaries.
- Pure domain logic (`src/domain`) is built and property-tested before any
  playhtml bindings, so correctness is established without a live server.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.4", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1", "8.3"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.6", "3.2", "3.3", "3.4", "4.2", "5.2", "5.3", "5.4", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "7.2", "7.3", "8.2", "8.4"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8"] },
    { "id": 5, "tasks": ["10.9", "12.1", "12.2", "12.3", "13.1"] },
    { "id": 6, "tasks": ["12.4", "13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 7, "tasks": ["13.7", "14.1", "14.2", "14.3", "14.5"] },
    { "id": 8, "tasks": ["14.4"] }
  ]
}
```
