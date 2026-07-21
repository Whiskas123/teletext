# Requirements Document

## Introduction

This feature re-architects the Teletext Workshop application to replace its
database and serverless-API persistence layer (Vercel functions in `api/` backed
by Redis or a local file store) with **playhtml**, a library for real-time
collaborative and persistent state built on Yjs. Beyond changing the storage
mechanism, the feature adds collaborative "rooms" that let multiple users watch
and edit teletext pages together in real time.

The feature introduces six capabilities:

1. **Rooms** — users join a shared room to co-watch teletext pages; the displayed
   page stays synchronized across all room members.
2. **Remote control voting** — a member requests a page change; other members vote
   to accept or reject before the change applies to everyone.
3. **Chat sidebar** — a live comment/chat stream scoped to the room.
4. **Collaborative editing** — multiple members edit the same page simultaneously
   with cell-level conflict resolution.
5. **Persistence migration** — page storage moves from the Redis/file API layer to
   playhtml-backed shared state, and the existing `api/` layer is removed.
6. **TV Guide** — each page can carry a human-readable title that members edit
   collaboratively alongside page content; the guide is a browsable "book" of pages
   and their titles that members consult while watching, selecting an entry to
   propose a page change through the existing voting flow.

The teletext page model is unchanged: a 40×24 grid of 960 `Cell` objects, each
with `char`, `fg`, `bg`, optional `graphics` (sixel 0-63), `graphicsColors`, and
`blink`. Existing routes (`/`, `/view`, `/edit/:pageNumber`) are retained, and the editable
page range is widened to any Page_Number from 001 to 999.

## Glossary

- **Teletext_Page**: An ordered array of 960 `Cell` objects representing a 40×24
  teletext grid, as defined in `src/types/teletext.ts`.
- **Page_Number**: An integer from 1 to 999 inclusive that names a Teletext_Page,
  displayed as three digits (001–999). Any Page_Number may be edited; pages with no
  stored content are treated as empty.
- **Non_Empty_Page**: A Teletext_Page that contains at least one Cell differing from
  the default empty Cell (`char` = space, `fg` = white, `bg` = black, no graphics).
- **Cell**: A single grid position holding `char`, `fg`, `bg`, and optional
  `graphics`, `graphicsColors`, and `blink` fields.
- **System**: The Teletext Workshop client application as a whole.
- **Room**: A named collaborative session, identified by a Room_ID, whose members
  share synchronized viewing state, chat, voting state, and editing state.
- **Room_ID**: A human-usable string that uniquely identifies a Room and serves as
  the playhtml room namespace.
- **Member**: A connected user session participating in a Room.
- **Presence_Service**: The System component that tracks which Members are present
  in a Room and their identity attributes (display name and color), backed by
  playhtml awareness.
- **Identity**: A Member's display name and assigned color used to attribute
  presence, chat, votes, and cursors.
- **Room_Sync_Service**: The System component that keeps the currently displayed
  Page_Number synchronized across all Members of a Room using playhtml shared
  state.
- **Change_Request**: A pending proposal by a Member to change the Room's displayed
  Page_Number to a target Page_Number, subject to voting.
- **Vote**: A Member's accept or reject decision on an active Change_Request.
- **Vote_Base**: The count of Members present in the Room at the instant a
  Change_Request is created, used to compute the Accept_Threshold.
- **Accept_Threshold**: The number of accept Votes required to accept a
  Change_Request, defined as floor(Vote_Base / 2) + 1.
- **Voting_Service**: The System component that manages Change_Request lifecycle,
  vote tallying, and resolution.
- **Chat_Service**: The System component that stores and distributes chat messages
  within a Room.
- **Chat_Message**: A single text comment authored by a Member, carrying author
  Identity, message text, and a timestamp.
- **Edit_Service**: The System component that applies concurrent Cell edits to a
  shared Teletext_Page and resolves conflicts at Cell granularity.
- **Playhtml_Store**: The playhtml-backed shared, persistent data layer (Yjs) that
  replaces the previous Redis/file API persistence.
- **Page_Title**: A human-readable text label associated with a Page_Number,
  containing 0 to 60 characters after trimming leading and trailing whitespace. A
  Page_Title of length 0 denotes a page with no title.
- **Guide_Entry**: The pairing of a Page_Number with its Page_Title, forming one
  listable row of the TV_Guide.
- **TV_Guide**: A browsable listing ("book") of Guide_Entries ordered by
  Page_Number that a Member can open and consult while viewing a Room without
  changing the Room's currently displayed Page_Number.
- **Guide_Service**: The System component that stores, synchronizes, and presents
  Page_Titles and the TV_Guide, backed by the Playhtml_Store.

## Requirements

### Requirement 1: Room Creation and Joining

**User Story:** As a user, I want to create or join a named room, so that I can watch and edit teletext pages together with other people.

#### Acceptance Criteria

1. WHEN a user opens the application without a Room_ID in the URL, THE System SHALL display a control to create a new Room and a separate control to join an existing Room by entering a Room_ID.
2. WHEN a user submits a request to create a new Room, THE System SHALL generate a Room_ID that contains solely letters, digits, and hyphens, is between 8 and 64 characters in length, and does not match the Room_ID of any currently active Room, and THE System SHALL navigate the user into that Room.
3. WHEN a user submits a non-empty Room_ID whose characters are solely letters, digits, and hyphens and whose length is between 1 and 64 characters, THE System SHALL navigate the user into the Room identified by that Room_ID.
4. WHERE a Room_ID is present in the application URL, THE System SHALL validate the Room_ID before connecting and SHALL connect the user to the Room only when the Room_ID contains solely letters, digits, and hyphens and is between 1 and 64 characters in length.
5. IF a submitted or URL-provided Room_ID is empty, exceeds 64 characters, or contains any character outside the set of letters, digits, and hyphens, THEN THE System SHALL reject the connection, remain on the entry screen without navigating into a Room, preserve any value the user entered, and display a validation message indicating that the Room_ID format is invalid.
6. WHILE a Member is connected to a Room, THE System SHALL display the Room's Room_ID together with a control that, when activated, copies the Room_ID to the system clipboard and displays a confirmation that the Room_ID was copied.

### Requirement 2: Member Identity and Presence

**User Story:** As a room member, I want to see who else is in the room and be identifiable, so that I can attribute actions to specific people.

#### Acceptance Criteria

1. WHEN a Member connects to a Room, THE Presence_Service SHALL assign the Member an Identity consisting of a display name of 1 to 32 characters and a color selected from the Room's predefined color palette.
2. WHEN a Member connects to a Room, THE Presence_Service SHALL add that Member to the displayed presence list, showing the Member's display name and color, within 2 seconds.
3. WHILE one or more Members are present in the Room, THE Presence_Service SHALL display each present Member's display name and color in the presence list.
4. WHEN a Member sets a display name of 1 to 32 characters, THE Presence_Service SHALL update that Member's Identity for all other Members within 2 seconds.
5. IF a Member sets a display name that is empty or exceeds 32 characters, THEN THE Presence_Service SHALL reject the change, retain the Member's previous display name, and return an error indication identifying the invalid display name.
6. WHEN a Member disconnects from a Room, THE Presence_Service SHALL remove that Member from the displayed presence list within 5 seconds.
7. THE Presence_Service SHALL display a count of Members currently present in the Room equal to the number of Members in the presence list, ranging from 0 to the Room's maximum member capacity.
8. WHILE no Members are present in the Room, THE Presence_Service SHALL display a "No members online" indication instead of an empty list.

### Requirement 3: Synchronized Page Viewing

**User Story:** As a room member, I want the displayed page to change for everyone when it changes for one person, so that we watch the same content together.

#### Acceptance Criteria

1. THE Room_Sync_Service SHALL maintain a single currently displayed Page_Number shared by all Members of a Room.
2. WHEN the Room's displayed Page_Number changes, THE Room_Sync_Service SHALL update the displayed Teletext_Page for every Member of the Room within 2 seconds.
3. WHEN a Member joins a Room that already has a displayed Page_Number, THE Room_Sync_Service SHALL display that Page_Number to the joining Member within 2 seconds of the join completing.
4. WHERE no Page_Number has yet been set for a Room, THE Room_Sync_Service SHALL display Page_Number 100 as the default.
5. IF a Page_Number outside the range 1 to 999 is requested as the displayed page, THEN THE Room_Sync_Service SHALL reject the change, retain the current displayed Page_Number for all Members, and return a rejection indication to the requesting Member.
6. WHEN a Member advances to the next page during viewing, THE Room_Sync_Service SHALL set the Room's displayed Page_Number to the next higher Non_Empty_Page within the range 1 to 999, skipping empty pages and wrapping from 999 to 1.
7. WHEN a Member returns to the previous page during viewing, THE Room_Sync_Service SHALL set the Room's displayed Page_Number to the next lower Non_Empty_Page within the range 1 to 999, skipping empty pages and wrapping from 1 to 999.
8. IF a Member advances to the next page or returns to the previous page and no Non_Empty_Page other than the current displayed Page_Number exists in the range 1 to 999, THEN THE Room_Sync_Service SHALL retain the current displayed Page_Number and return an indication to the requesting Member that no other Non_Empty_Page is available.
9. WHEN two or more Members request a change to the displayed Page_Number within the same 2 second interval, THE Room_Sync_Service SHALL apply the requests in the order received and synchronize all Members to the most recently applied Page_Number.

### Requirement 4: Remote Control Change Request and Voting

**User Story:** As a room member, I want to propose a page change that others vote on, so that the group decides together what to watch next.

#### Acceptance Criteria

1. WHEN a Member submits a target Page_Number as a Change_Request and no active Change_Request exists, THE Voting_Service SHALL create an active Change_Request visible to all Members of the Room, record the count of Members present in the Room at that instant as the Vote_Base, and record one implicit accept Vote attributed to the submitting Member.
2. IF an active Change_Request already exists when a Member submits a new Change_Request, THEN THE Voting_Service SHALL reject the new submission and retain the existing active Change_Request.
3. WHILE a Change_Request is active, THE Voting_Service SHALL allow each Member who has not yet voted to cast exactly one Vote of accept or reject, where the submitting Member's implicit accept Vote counts as that Member's single Vote.
4. IF a Member who has already cast a Vote on the active Change_Request attempts to cast another Vote, THEN THE Voting_Service SHALL reject the additional Vote and retain the Member's existing Vote.
5. WHEN a Member casts a Vote on the active Change_Request, THE Voting_Service SHALL record the Vote attributed to that Member and update the displayed tally for all Members within 2 seconds.
6. WHEN the number of accept Votes reaches or exceeds the Accept_Threshold, defined as floor(Vote_Base / 2) + 1 where Vote_Base is the count recorded at creation, THE Voting_Service SHALL resolve the Change_Request as accepted and set the Room's displayed Page_Number to the requested target Page_Number.
7. WHEN the sum of the cast accept Votes plus the number of Members still present in the Room who have not yet voted falls below the Accept_Threshold, THE Voting_Service SHALL resolve the Change_Request as rejected and retain the current displayed Page_Number.
8. WHILE a Change_Request is active, THE Voting_Service SHALL keep Vote_Base fixed at the value recorded at creation regardless of Members joining or leaving, SHALL discard any Vote previously attributed to a Member who leaves the Room, and SHALL reject any Vote from a Member who joined the Room after the Change_Request was created.
9. IF an active Change_Request receives no Vote that resolves it as accepted or rejected within 60 seconds of its creation, THEN THE Voting_Service SHALL resolve the Change_Request as expired and retain the current displayed Page_Number.
10. WHEN a Change_Request is resolved as accepted, rejected, or expired, THE Voting_Service SHALL clear the active Change_Request so that a new Change_Request can be submitted.
11. IF the requested target Page_Number is not an integer within the inclusive range 1 to 999, THEN THE Voting_Service SHALL reject the Change_Request submission, create no active Change_Request, and display a validation message indicating the Page_Number is out of range.

### Requirement 5: Room Chat Sidebar

**User Story:** As a room member, I want a live chat sidebar, so that I can comment and coordinate with others in the room.

#### Acceptance Criteria

1. WHEN a Member views a Room, THE Chat_Service SHALL display a sidebar containing the Room's Chat_Messages ordered chronologically from oldest to newest by timestamp.
2. WHILE a Room has no Chat_Messages, THE Chat_Service SHALL display an empty-chat indication instead of an empty area.
3. WHEN a Member submits a Chat_Message whose text, after trimming leading and trailing whitespace, is between 1 and 500 characters, THE Chat_Service SHALL append the Chat_Message to the Room's chat with the author's Identity and a timestamp.
4. WHEN a Chat_Message is added to a Room, THE Chat_Service SHALL display the new Chat_Message, including its author Identity and timestamp, to every connected Member of the Room within 2 seconds.
5. IF a Member submits a Chat_Message that is empty or contains only whitespace, THEN THE Chat_Service SHALL reject the submission, leave the chat unchanged, and return an error indication that the message was empty.
6. IF a Member submits a Chat_Message whose trimmed text exceeds 500 characters, THEN THE Chat_Service SHALL reject the submission, leave the chat unchanged, and return an error indication that the message length limit was exceeded.
7. WHEN a Member joins a Room, THE Chat_Service SHALL display the existing Chat_Messages of that Room to the joining Member ordered chronologically from oldest to newest by timestamp.

### Requirement 6: Concurrent Collaborative Editing

**User Story:** As a room member, I want to edit a page at the same time as others, so that we can build a teletext page collaboratively.

#### Acceptance Criteria

1. WHILE Members are editing the same Teletext_Page in a Room, THE Edit_Service SHALL apply each Cell edit to the shared Teletext_Page and propagate the change to every editing Member within 2 seconds.
2. WHEN two Members edit different Cells of the same Teletext_Page concurrently, where "concurrently" means each edit is applied before the other edit has propagated to that Member, THE Edit_Service SHALL preserve both edits and converge all Members to the same Teletext_Page within 2 seconds.
3. WHEN two Members edit the same Cell concurrently, THE Edit_Service SHALL resolve the conflict to the value of the edit that was applied last, and every Member's copy of that Cell SHALL converge to that identical value within 2 seconds.
4. THE Edit_Service SHALL preserve the Teletext_Page size of exactly 960 Cells after applying any edit.
5. WHEN a Member edits a Cell, THE Edit_Service SHALL retain the values of all other Cells in the Teletext_Page.
6. WHERE presence cursors are enabled, THE Edit_Service SHALL display the editing position of each other Member on the shared grid, attributed by that Member's Identity color, and update each displayed position within 2 seconds of it changing.
7. IF a Member submits a Cell edit whose `graphics` value is outside the range 0 to 63 or whose `char`, `fg`, or `bg` field is missing, THEN THE Edit_Service SHALL reject the edit, retain the current value of that Cell, and return a validation indication.
8. WHEN a Member stops editing or disconnects from the Room, THE Edit_Service SHALL remove that Member's editing cursor from the shared grid within 5 seconds.

### Requirement 7: Persistence Migration to Playhtml

**User Story:** As a developer, I want page persistence handled by playhtml instead of the database and serverless API, so that state syncs in real time and the backend layer is removed.

#### Acceptance Criteria

1. THE System SHALL persist every Teletext_Page in the Playhtml_Store keyed by Page_Number across the full range 1 to 999.
2. WHERE a Member navigates to the editor for any Page_Number from 1 to 999, THE System SHALL allow editing of the Teletext_Page for that Page_Number.
3. WHEN a Member changes one or more Cells of a Teletext_Page, THE System SHALL persist the modified Teletext_Page to the Playhtml_Store within 2 seconds so that the change is available to future sessions.
4. WHEN the application loads a Page_Number from 1 to 999 that has no stored Teletext_Page, THE System SHALL display an empty Teletext_Page of exactly 960 Cells.
5. THE System SHALL retrieve Teletext_Pages exclusively from the Playhtml_Store and SHALL NOT call the `/api/pages` endpoints.
6. THE System SHALL remove the serverless API layer under `api/` and the `redis` dependency from the project.
7. WHERE a Teletext_Page retrieved from the Playhtml_Store does not contain exactly 960 Cells each with defined `char`, `fg`, and `bg` fields, THE System SHALL substitute an empty Teletext_Page of exactly 960 Cells.
8. WHEN a Teletext_Page is persisted to the Playhtml_Store, THE System SHALL propagate the updated Teletext_Page to all sessions currently viewing that Page_Number within 2 seconds.
9. IF persisting a modified Teletext_Page to the Playhtml_Store fails, THEN THE System SHALL retain the Member's current edits in the editor and display an error indication that the change was not saved.

### Requirement 8: Connection and Synchronization Resilience

**User Story:** As a room member, I want the application to handle connection loss gracefully, so that I understand the state and do not lose my work.

#### Acceptance Criteria

1. IF the connection to the Playhtml_Store is lost, THEN THE System SHALL display a disconnected status indicator to the Member within 5 seconds of the connection loss.
2. WHEN the connection to the Playhtml_Store is restored, THE System SHALL update the displayed Teletext_Page to match the Room's current shared displayed Page_Number and SHALL remove the disconnected status indicator within 5 seconds.
3. WHILE the connection to the Playhtml_Store is lost, THE System SHALL retain the last known displayed Teletext_Page for the Member without clearing or resetting it.
4. WHILE the connection to the Playhtml_Store is lost, THE System SHALL allow the Member to continue editing the currently displayed Teletext_Page and SHALL retain those edits locally.
5. WHEN the connection to the Playhtml_Store is restored, THE System SHALL apply the Member's locally retained edits to the shared Teletext_Page without discarding them, resolving any conflicts at Cell granularity to a single deterministic Cell value identical for every Member.

### Requirement 9: TV Guide of Page Titles

**User Story:** As a room member, I want each page to have an editable title collected into a browsable TV guide, so that I can see what each page is and consult the guide while watching TV.

#### Acceptance Criteria

1. THE Guide_Service SHALL maintain a single Page_Title for each Page_Number in the range 1 to 999, persisted in the Playhtml_Store keyed by Page_Number.
2. WHERE a Page_Number from 1 to 999 has no stored Page_Title, THE Guide_Service SHALL treat that Page_Number as having a Page_Title of length 0.
3. WHILE a Member is editing a Teletext_Page in the editor, THE Guide_Service SHALL display an editable Page_Title field for that Page_Number's current Page_Title.
4. WHEN a Member sets a Page_Title whose trimmed text is between 0 and 60 characters for the Page_Number being edited, THE Guide_Service SHALL persist the trimmed Page_Title to the Playhtml_Store within 2 seconds, treating a submitted empty or whitespace-only value as a Page_Title of length 0.
5. WHEN a Page_Title is persisted to the Playhtml_Store, THE Guide_Service SHALL propagate the updated Page_Title to every Member viewing or editing that Page_Number and to every Member with the TV_Guide open within 2 seconds.
6. IF a Member submits a Page_Title whose trimmed text exceeds 60 characters, THEN THE Guide_Service SHALL reject the change, retain the current Page_Title for that Page_Number, and return an error indication that the title length limit was exceeded.
7. WHEN a Member opens the TV_Guide, THE Guide_Service SHALL display a listing of Guide_Entries for every Page_Number that is a Non_Empty_Page or has a Page_Title of length 1 or greater, with each Guide_Entry showing its Page_Number and Page_Title, ordered by ascending Page_Number.
8. WHERE a listed Guide_Entry has a Page_Title of length 0, THE Guide_Service SHALL display a "No title" indication in place of the Page_Title for that Guide_Entry.
9. WHILE the TV_Guide is open for a Member, THE Guide_Service SHALL retain the Room's currently displayed Page_Number unchanged for that Member and for all other Members.
10. WHEN a Member selects a Guide_Entry from the TV_Guide while viewing a Room, THE Guide_Service SHALL submit the selected Guide_Entry's Page_Number to the Voting_Service as a Change_Request rather than directly setting the Room's displayed Page_Number.
11. WHILE the TV_Guide is open and no Guide_Entry qualifies for listing, THE Guide_Service SHALL display an empty-guide indication instead of an empty listing.
12. WHEN two Members set the Page_Title of the same Page_Number concurrently, where "concurrently" means each edit is applied before the other edit has propagated to that Member, THE Guide_Service SHALL resolve the conflict to the value of the edit that was applied last, and every Member's copy of that Page_Title SHALL converge to that identical value within 2 seconds.
13. WHILE the TV_Guide is open for a Member, WHEN a Page_Number begins qualifying for listing by becoming a Non_Empty_Page or gaining a Page_Title of length 1 or greater, or stops qualifying by becoming empty with a Page_Title of length 0, THE Guide_Service SHALL add or remove that Guide_Entry in the displayed listing, preserving ascending Page_Number order, within 2 seconds.
