# One-shot data migrations (runbook)

Backfills that must be run by hand against each Convex deployment after the code that
needs them is deployed. Each entry says what it does, whether it is safe to re-run, the
exact commands and how to verify. Run from `packages/backend` with a logged-in CLI
(`npx convex login`). Without a flag `npx convex run` targets the dev deployment of the
linked project; `--prod` targets production.

Always run **dev first, then prod**, and always do the dry run before the real run.

---

## `notifications/backfillRefs` — actor/subject refs on existing notifications

**When:** once per deployment, after the rich-notifications backend (N2..N5: the schema
fields, the subscriber writing refs, the `listMyNotificationViews` read model and the
web switch) is deployed there. The read model works without it (rows without refs
fall back to `params` + generic copy), so there is no deploy ordering pressure: it only
makes older notifications render with live actor names, avatars and deep links.

**What it does:** pages through `notifications` (100 rows per batch, each batch its own
transaction, rescheduling itself until the table is exhausted) and, for rows that carry
neither `subject` nor `actorIds`, derives what the subscriber now writes for new rows
(spec 5.6):

- trade\_\* / exchange_disputed: exchange row by `relatedId` → actor = the recipient's
  counterparty, subject = the exchange aggregateId (absent for legacy exchanges
  without one).
- message_received: thread by aggregateId → subject; actor only in a 2-participant
  thread.
- review_received: review by aggregateId → reviewer as actor (only for the reviewee).
- new_follower / follow_request_approved: actor = `relatedId`.
- follow_request_received: actor = `relatedId`; subject = the newest request from that
  requester to the recipient created at or before the notification.
- household_invite_received: invite by aggregateId → inviter; household_invite_accepted:
  household subject, actor = invitee of the recipient's accepted invite whose
  `respondedAt` lies nearest the notification (else no actor).
- puzzle/proposal outcomes, goal_achieved, photo_removed, whats_new: subject only
  (moderation outcomes never get an actor).
- admin_proposal_filed / admin_definition_submitted: proposer / submitter as actor plus
  the proposal / puzzle subject.

It writes only `actorIds`, `actorCount` and `subject`; it never touches `isRead`,
`createdAt`, `params` or `type`. Anything it cannot derive with certainty stays absent.

**Safe to re-run:** yes. Rows that already have `subject` or `actorIds` are skipped, so
a second run patches 0 rows.

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, writes nothing), then the real run
npx convex run notifications/backfillRefs:backfillRefs '{"dryRun":true}'
npx convex run notifications/backfillRefs:backfillRefs '{}'

# prod: same, after dev looks right
npx convex run --prod notifications/backfillRefs:backfillRefs '{"dryRun":true}'
npx convex run --prod notifications/backfillRefs:backfillRefs '{}'
```

The command returns the FIRST batch's `{ scanned, patched, skipped }`; the remaining
batches run as scheduled functions. Each batch logs a line
`notifications/backfillRefs batch {...,"totals":{...},"isDone":...}` (prefixed
`(dry run)` for dry runs); the line with `"isDone":true` carries the whole run's totals.
Follow it with `npx convex logs` (add `--prod` for prod) or in the dashboard Logs.

**Verify:**

1. The real run's final `totals.patched` matches the dry run's final `totals.patched`
   (give or take notifications created in between, which already carry refs).
2. Run the dry run again: its final totals show `"patched":0`.
3. In the dashboard data view, spot-check a few older `notifications` rows: they now
   carry `actorIds`/`actorCount`/`subject` and their `isRead`/`createdAt`/`params` are
   unchanged; the bell shows names instead of "Someone" for those rows.

---

## `exchange/backfillTradeReveals` — per-trade owner reveals for existing exchanges

**When:** once per deployment, right after the per-trade reveal backend (the
`tradeReveals` table, `exchange/tradeRevealSubscriber` and the exchange-view projection)
is deployed there. Until it runs, a private owner of an exchange created before that
deploy stays hidden from the requester inside that trade even if they already accepted
or replied (exchange views now hide hidden parties). The owner always sees the requester
(derived, no row needed), and new exchanges are covered by the subscriber, so run it
soon after deploying.

**What it does:** pages through `exchanges` (25 rows per batch, each batch its own
transaction, rescheduling itself until the table is exhausted) and, per exchange
without a `tradeReveals` row, applies the domain rule (`tradeRevealReasonFromHistory`):

- status `accepted` / `completed` / `disputed`, or the "Exchange accepted" lifecycle
  system message in that exchange's own thread -> a row with `reason: "accepted"`.
- otherwise an owner-authored message in that thread, or an owner-sent, non-system row
  in the legacy `messages` chat -> `reason: "owner_replied"`.
- otherwise nothing (fails closed: the owner stays hidden). Counted as `notActed`.

Only the oldest 200 messages of each thread / legacy chat are read (bounded per
transaction). It only inserts `tradeReveals` rows; it never modifies exchanges, threads
or messages. A reveal only ever applies inside that one exchange.

**Safe to re-run:** yes. An exchange that already has a row is skipped (counted as
`existing`), so a second run creates 0 rows.

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, writes nothing), then the real run
npx convex run exchange/backfillTradeReveals:backfillTradeReveals '{"dryRun":true}'
npx convex run exchange/backfillTradeReveals:backfillTradeReveals '{}'

# prod: same, after dev looks right
npx convex run --prod exchange/backfillTradeReveals:backfillTradeReveals '{"dryRun":true}'
npx convex run --prod exchange/backfillTradeReveals:backfillTradeReveals '{}'
```

The command returns the FIRST batch's `{ scanned, created, existing, notActed }`; the
remaining batches run as scheduled functions. Each batch logs a line
`exchange/backfillTradeReveals batch {...,"totals":{...},"isDone":...}` (prefixed
`(dry run)` for dry runs); the line with `"isDone":true` carries the whole run's totals.
Follow it with `npx convex logs` (add `--prod` for prod) or in the dashboard Logs.

**Verify:**

1. The real run's final `totals.created` matches the dry run's (give or take exchanges
   the owner acted on in between, which the subscriber already covers).
2. Run the dry run again: its final totals show `"created":0`.
3. In the dashboard data view, `tradeReveals` holds rows; spot-check an older accepted
   exchange between two private members: the requester now sees the owner (name, no
   avatar) in that exchange's view, while an older proposal the owner never answered
   still shows the owner as "member" to the requester.

---

## `library/rescreenPhotos` — screen photos that were never checked

**When:** once per deployment, after the photo-screening fix (router endpoint + `unscored`
outcome) is deployed there **and** the probe below returns `"screening_outcome":"scored"`.
Until then the old pipeline called a retired Hugging Face host and approved every photo
it could not check, so copy and completion photos uploaded in that period were published
unchecked.

**What it does:** pages through `ownedPuzzleImages` (`"table":"copy"`) or the
`completionImages` sidecars (`"table":"completion"`), 10 rows per batch, and classifies
the rows that were never actually checked: `moderationStatus` `"unscored"`, or approved
(or absent, the legacy default) **without** a `moderationScore`. Rows that are pending,
rejected or already scored are skipped. Photos are classified one at a time and each
batch reschedules itself 10 s later (`batchSize` and `delayMs` override this), which
keeps it inside the free-tier rate limits of the screening provider (Hugging Face or
Sightengine).

- Clean score: the row is set to approved with its score.
- nsfw score at or above the threshold: the row is rejected, exactly like a fresh upload.
  It is hidden and stamped `photo_auto_rejected`; a completion photo is also detached
  from its completion and its blob deleted. Copy photos land in the admin Flagged
  Images queue, where they can be restored.
- Could not be checked: the row is left exactly as it was. A legacy photo is never
  hidden by a provider hiccup.

On a configuration error (missing token, 401/403, 404 model) the run stops. On 429 or
5xx it retries the same page with exponential backoff, up to 5 times in a row, then
stops. Completion photos that predate sidecars (no `completionImages` row) are not
covered.

**Safe to re-run:** yes. Scored rows are no longer candidates, so a second run only
picks up what is still unchecked.

**Commands:**

```bash
cd packages/backend

# 0. probe: one classification of a generated grey test image (no user data)
npx convex run admin/probePhotoScreening:probePhotoScreening
#    expect "config_status":"ok", "screening_outcome":"scored", "http_status":200

# dev: dry run (counts only, no classifier calls, no writes), then the real run
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"copy","dryRun":true}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"completion","dryRun":true}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"copy"}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"completion"}'

# prod: same, after dev looks right (add --prod to each command, probe first)
npx convex run --prod admin/probePhotoScreening:probePhotoScreening
npx convex run --prod library/rescreenPhotos:rescreenPhotos '{"table":"copy","dryRun":true}'
```

Each batch logs one JSON line with `"event":"library.rescreenPhotos"`, the `batch` and
running `totals` (`scanned`, `candidates`, `approved`, `rejected`, `unscored`,
`skipped`) and a `result` (`done`, `backoff`, `aborted_config`,
`aborted_provider_unavailable`). Follow it with `npx convex logs` (add `--prod`).

**Verify:**

1. The final line says `"result":"done"`, and `totals.candidates` matches the dry run.
2. A second dry run reports `candidates` close to 0. The remainder are photos whose
   classification failed for that image, so they stay as they were.
3. The admin moderation console no longer shows the "Photo screening needs attention"
   warning (no unscored photos). Any new rejections appear under Flagged Images.

**Monitoring (Axiom):** every moderation attempt emits `library.moderatePhoto` /
`solving.moderateCompletionPhoto` with `screening_outcome` (`scored` | `unscored` |
`disabled`) and `unscored_reason`. Alert when the share of `unscored` outcomes is high,
for example more than 20% over an hour:
`['jigswap'] | where event in ("library.moderatePhoto","solving.moderateCompletionPhoto") | summarize unscored=countif(screening_outcome=="unscored"), total=count() by bin(_time, 1h)`.

---

## `library/backfillCopyVisibility` — per-copy visibility becomes authoritative

**When:** any time after the per-copy visibility toggle (the `ownedPuzzles.visibilityAuthoritative`
marker, `library/copyVisibility.effectiveCopyVisibility` and the "Visible to the community /
Private" control) is deployed there. There is no ordering pressure in either direction: until a row
carries the marker, the read side treats it as visible whatever `visibility` it stores (a stored
`"private"` on such a row was the old domain default, never an owner's choice), and every domain
save already writes the marker. So before the backfill nothing is hidden that wasn't before, and
after it nothing changes either — it only turns the legacy rows' implicit "visible" into an explicit,
stored one, so a follow-up can drop the marker.

**What it does:** pages through `ownedPuzzles` (100 rows per batch, each batch its own
transaction, rescheduling itself until the table is exhausted) and, for every row WITHOUT
`visibilityAuthoritative`, writes `visibility: "visible"` and `visibilityAuthoritative: true`.
Rows that already carry the marker — written by the domain repository, so possibly an owner who
made a copy private before the backfill ran — are skipped and never overwritten. It writes only
those two fields (not `updatedAt`: this is not an owner edit).

**Safe to re-run:** yes. Marked rows are skipped, so a second run patches 0 rows.

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, writes nothing), then the real run
npx convex run library/backfillCopyVisibility:backfillCopyVisibility '{"dryRun":true}'
npx convex run library/backfillCopyVisibility:backfillCopyVisibility '{}'

# prod: same, after dev looks right
npx convex run --prod library/backfillCopyVisibility:backfillCopyVisibility '{"dryRun":true}'
npx convex run --prod library/backfillCopyVisibility:backfillCopyVisibility '{}'
```

The command returns the FIRST batch's `{ scanned, patched, skipped, wasPrivate }` (`wasPrivate`
counts the patched rows that stored the old `"private"` default); the remaining batches run as
scheduled functions. Each batch logs a line
`library/backfillCopyVisibility batch {...,"totals":{...},"isDone":...}` (prefixed `(dry run)` for
dry runs); the line with `"isDone":true` carries the whole run's totals. Follow it with
`npx convex logs` (add `--prod` for prod) or in the dashboard Logs.

**Verify:**

1. The real run's final `totals.patched` matches the dry run's final `totals.patched` (give or take
   copies saved in between, which already carry the marker).
2. Run the dry run again: its final totals show `"patched":0`.
3. In the dashboard data view, every `ownedPuzzles` row has `visibilityAuthoritative: true`; rows
   an owner made private still read `visibility: "private"`.
4. Spot-check a member's profile as a mutual follower: the same copies are listed as before.

## `sharing/backfillStaleCircleShares` — remove circle shares left behind by ownership transfers

**When:** once per deployment, after #184 (a `CopyOwnershipTransferred` deletes the copy's
circle shares in the same transaction) is deployed there. Before #184 a settled sale or swap
left the copy's `circleCopyShares` rows in place, so members of the previous owner's circles
kept reaching the new owner's copy. #185 makes most of these harmless, but not when the new
owner is a member of that same circle. Running it before #184 is deployed is safe but
incomplete: transfers settling in between leave new stale rows, so run it (again) after.

**What it does:** pages through `circleCopyShares` (25 rows per batch, `batchSize` overrides
it, rounded down and clamped to 1..50 so a worst-case batch stays under Convex's
per-transaction read limit; each batch its own transaction, rescheduling itself until the
table is exhausted).
A share row stores no sharer, so the rule derives it: only the copy's owner can share it, so
the sharer is whoever owned the copy at `sharedAt`, and every ownership change is recorded in
`copyCustodyEntries` (previous and new owner). Per share:

- the copy no longer exists -> deleted, counted `dangling` (copy deletion never withdrew
  shares; the link points at nothing).
- no transfer after `sharedAt` -> the sharer still owns it, `kept`.
- the first transfer after `sharedAt` names the sharer; the copy came back to that member
  -> `kept`.
- the current owner shared it into the same circle again after the last transfer (a
  `CopySharedToCircle` event for that circle and copy in `domainEvents`) -> `kept`.
- otherwise the current owner never shared it into this circle -> deleted, counted `stale`.

When the re-share check cannot finish within its bounded scan (500 later share events) the
row is left alone and counted `undetermined`; it never deletes on a guess. It only deletes
`circleCopyShares` rows; copies, circles, memberships and events are untouched.

**Safe to re-run:** yes. Deleted rows are gone and every remaining row gets the same verdict
again, so a second run deletes 0 rows.

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, deletes nothing), then the real run
npx convex run sharing/backfillStaleCircleShares:backfillStaleCircleShares '{"dryRun":true}'
npx convex run sharing/backfillStaleCircleShares:backfillStaleCircleShares '{}'

# prod: same, after dev looks right
npx convex run --prod sharing/backfillStaleCircleShares:backfillStaleCircleShares '{"dryRun":true}'
npx convex run --prod sharing/backfillStaleCircleShares:backfillStaleCircleShares '{}'
```

The command returns the FIRST batch's `{ scanned, stale, dangling, kept, undetermined }`; the
remaining batches run as scheduled functions. Each batch logs a line
`sharing/backfillStaleCircleShares batch {...,"totals":{...},"isDone":...}` (prefixed
`(dry run)` for dry runs); the line with `"isDone":true` carries the whole run's totals.
A batch line also lists the rows it acted on as opaque ids `{ shareId, circleId, copyId }`
(no member ids, names or emails): `undeterminedRows` on every run, and `deletedRows` on a
real run only. Follow it with `npx convex logs` (add `--prod` for prod) or in the dashboard
Logs, and keep the real run's lines: they are the only record of what was deleted.

**Verify:**

1. The real run's final `totals.stale` and `totals.dangling` match the dry run's.
2. Run the dry run again: its final totals show `"stale":0` and `"dangling":0`.
3. `totals.undetermined` is 0. If not, those rows were kept; take each from
   `undeterminedRows` and check it by hand in the dashboard (the `ownedPuzzles` row whose
   `aggregateId` is `copyId`, that row's `copyCustodyEntries` by its `_id`, and whether its
   current owner shared it into `circleId`), then delete the `circleCopyShares` row `shareId`
   there if stale.
4. The real run's `deletedRows` add up to `totals.stale + totals.dangling`, and none of
   those `shareId`s is still in `circleCopyShares`.
5. Spot-check a copy that changed hands before #184: it has no `circleCopyShares` row for the
   previous owner's circles, and a member of such a circle with no other path to it (not
   mutual with the new owner, no shared household) no longer sees it on Browse.

**Rollback:** none needed and none possible from the backfill itself. A wrongly removed share
is found in the real run's `deletedRows` (its `circleId` and `copyId`) and restored by the
copy's owner sharing it into that circle again (`sharing/shareCopyToCircle` recreates the
row), or by re-inserting a `circleCopyShares` row with that `circleId` and `copyId` in the
dashboard (`sharedAt` = now).

---

## `conversation/backfillParticipantState` — denormalised inbox state on existing threads

**When:** once per deployment, after the conversation participant-state change (receipts
and unread counts on `threadParticipants`, `threads.lastMessage`) is deployed there. The
reads work without it (rows without the fields fall back to the old receipt lookup and
message scans), so there is no deploy ordering pressure: it removes those per-row scans
from the inbox and the unread badge. It must have run before the follow-up PR that drops
`threads.readReceipts`.

**Legacy `conversation/backfill:run` (exchange chat → threads):** neither this runbook nor
the code records whether that older one-shot has completed in production (the legacy
`messages` table is still in the schema, and its comment says the table is dropped once
the backfill has run there). Confirm that before this deploy. Do **not** run it after
this deploy: it raises `threads.readReceipts` and creates participant rows without
`lastReadAt`, `unreadCount` or `lastActivityAt`, so its effect would only reach the
fallback reads. If it must still run, run it first and then run this backfill.

**What it does:** pages through `threads` (25 threads per batch by default, `batchSize`
overrides it; each batch is its own transaction and reschedules the next until the table
is exhausted) and fills only fields that are absent:

- `threads.lastMessage`: the newest message (`by_thread_sent`), body truncated to 280
  characters and blank for `image` rows. Threads without messages stay without one.
- per `threadParticipants` row:
  - `lastReadAt` from the member's entry in `threads.readReceipts` (left absent when the
    member never read the thread);
  - `unreadCount` by the same capped scan the reads fall back to (50 = "50 or more"; the
    scan reads at most 500 rows, so a member with a very long run of their own messages
    after their receipt gets a lower bound);
  - `lastActivityAt` = the thread's `lastMessageAt`, or `createdAt` while empty.

It never overwrites a field the live write paths already set, and it never touches
`threads.readReceipts`, `lastMessageAt`, participants or messages.

**Safe to re-run:** yes. Every field is written only when absent, so a second run patches
0 threads and 0 participant rows.

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, writes nothing), then the real run
npx convex run conversation/backfillParticipantState:backfillParticipantState '{"dryRun":true}'
npx convex run conversation/backfillParticipantState:backfillParticipantState '{}'

# prod: same, after dev looks right
npx convex run --prod conversation/backfillParticipantState:backfillParticipantState '{"dryRun":true}'
npx convex run --prod conversation/backfillParticipantState:backfillParticipantState '{}'

# if a batch hits a read limit, retry with a smaller batch (the default is 25)
npx convex run --prod conversation/backfillParticipantState:backfillParticipantState '{"dryRun":true,"batchSize":10}'
npx convex run --prod conversation/backfillParticipantState:backfillParticipantState '{"batchSize":10}'
```

The command returns the FIRST batch's `{ threadsScanned, threadsPatched,
participantsPatched }`; the remaining batches run as scheduled functions. Each batch logs a
line `conversation/backfillParticipantState batch {...,"totals":{...},"isDone":...}`
(prefixed `(dry run)` for dry runs); the line with `"isDone":true` carries the whole run's
totals. Follow it with `npx convex logs` (add `--prod` for prod) or in the dashboard Logs.

**Verify:**

1. The real run's final `totals` match the dry run's final `totals` (give or take threads
   that received a message or a read in between, which the live paths already filled).
2. Run the dry run again: its final totals show `"threadsPatched":0` and
   `"participantsPatched":0`.
3. In the dashboard data view, spot-check a few older `threadParticipants` rows: they carry
   `unreadCount` and `lastActivityAt` (and `lastReadAt` where the thread row has a receipt
   for that member), and threads with messages carry `lastMessage`. The inbox shows the
   same unread counts and snippets as before the run.

## `lib/imageModeration/backfillStripMetadata` — strip metadata from images stored before

**When:** once per deployment, after the server-side metadata strip (box art through
`catalog/sanitizeBoxArt`, WebP in the photo pipeline) is deployed there. Before it, box art
was stored exactly as uploaded, and copy or completion photos in WebP (and rows older than
the moderation pipeline) kept their EXIF, so some stored images still carry GPS
coordinates, camera details or editor comments.

**What it does:** pages through one table, 25 rows per batch (`batchSize` overrides this),
downloads each image and looks for metadata blocks (Exif incl. GPS, XMP, IPTC, comments,
PNG text chunks, WebP EXIF/XMP). An image that carries any is stripped at byte level (the
pixels are untouched; a JPEG keeps only its Orientation tag), stored as a new blob, every
row that pointed at the old blob is switched to it, and the old blob is deleted once
nothing references it. Clean images, GIFs and images whose structure can't be parsed are
left alone and counted.

- `"table":"boxArt"`: `puzzles.image`, plus the proposals of that definition whose
  `baseline.image` or `changes.image` is the same blob.
- `"table":"proposals"`: `puzzleChangeProposals.changes.image` (proposed box art).
- `"table":"copy"` / `"table":"completion"`: `ownedPuzzleImages` / `completionImages`
  (a completion's `photos` entry is switched too). Pending and quarantined rows are
  skipped: the moderation pipeline owns them.

`dryRun` defaults to **true**: without `"dryRun":false` it only counts.

```bash
# dev: dry run per table (counts only), then the real runs
npx convex run lib/imageModeration/backfillStripMetadata:backfillStripMetadata '{"table":"boxArt"}'
npx convex run lib/imageModeration/backfillStripMetadata:backfillStripMetadata '{"table":"proposals"}'
npx convex run lib/imageModeration/backfillStripMetadata:backfillStripMetadata '{"table":"copy"}'
npx convex run lib/imageModeration/backfillStripMetadata:backfillStripMetadata '{"table":"completion"}'
npx convex run lib/imageModeration/backfillStripMetadata:backfillStripMetadata '{"table":"boxArt","dryRun":false}'
# ...and the same for proposals, copy and completion

# prod: same, after dev looks right (add --prod to each command)
```

The command returns the FIRST batch's counts (`scanned`, `withMetadata`, `stripped`,
`clean`, `skipped`); the remaining batches run as scheduled functions. Each batch logs one
JSON line with `"event":"imageModeration.backfillStripMetadata"`, the table, `dry_run` and
the running totals; the line with `"done":true` carries the whole run's totals.

**Verify:** the real run's final `stripped` matches the dry run's `withMetadata`, and a
second dry run reports `"withMetadata":0`. Download a few switched images from the
dashboard and check them with `exiv2 -pa` or `exiftool`: nothing but `Orientation` on a
JPEG, nothing at all on PNG and WebP.
