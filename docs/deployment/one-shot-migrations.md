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

## `library/rescreenPhotos` — screen images that were never checked

**When:** once per deployment, after the photo-screening fix (router endpoint + `unscored`
outcome) is deployed there **and** the probe below returns `"screening_outcome":"scored"`.
Until then the old pipeline called a retired Hugging Face host and approved every photo
it could not check, so copy and completion photos uploaded in that period were published
unchecked. Box art and completion photos from before the sidecars never went through the
content check at all; run those tables once box art through the shared moderation
pipeline (`catalog/moderateBoxArt`, PR #337) is deployed there. Dev and prod screen with
Sightengine (`MODERATION_PROVIDER=sightengine`); the CSAM hash check is not configured
there, so only the content check runs.

**What it does:** pages through one table and classifies the images that were never
actually checked: `moderationStatus` `"unscored"`, approved (or absent, the legacy default)
**without** a `moderationScore`, or no moderation row at all. Rows that are pending,
rejected, quarantined, already scored or decided by an admin (`moderatedBy`) are skipped.

- `"table":"copy"`: `ownedPuzzleImages`.
- `"table":"completion"`: the `completionImages` sidecars.
- `"table":"completionLegacy"`: completion photos (`completions.photos`) with no
  `completionImages` sidecar, stored before sidecars existed. A photo that gets a verdict
  gets a sidecar. Completions without an `aggregateId` are skipped.
- `"table":"boxArt"`: `puzzles.image`. `"table":"proposals"`: `puzzleChangeProposals
.changes.image` (proposed box art). Box art without a `boxArtUploads` listing (stored
  before the listing existed) gets one when it gets a verdict, attributed to the
  definition's submitter or the proposer.

Each image follows the live pipeline:

- **Hash check first** (only when `CSAM_HASHCHECK_PROVIDER` is configured; with it unset
  this is a no-op and nothing is sent anywhere). A match is handled like a match on upload:
  preserved, quarantined, detached, escalated, stamped, never classified. A no_match is not
  recorded; `lib/imageModeration/backfillBoxArtHashCheck` stays the tool for that.
- **Clean score:** the row is set to approved with its score. The image stays served.
- **nsfw score at or above the threshold:** rejected, exactly like a fresh upload, and
  stamped `photo_auto_rejected`. A copy photo is hidden and lands in the admin Flagged
  Images queue, where it can be restored. A completion photo is detached from its
  completion and its blob deleted. Box art is detached from every definition and proposal
  holding it (the puzzle shows its placeholder) and its blob deleted.
- **Could not be checked:** the row is left exactly as it was (no row is created) and it is
  counted as `unscored`. A legacy image is never hidden by a provider hiccup.

`dryRun` defaults to **true**: without `"dryRun":false` it only counts (`candidates`) and
makes no classifier or hash-service call and no write. A real run refuses to start
(`"result":"aborted_config"`, nothing scanned) unless the classifier is configured
(`MODERATION_PROVIDER` with its credentials; `none` counts as not configured). On a
configuration error mid-run (missing credentials, 401/403, unknown model) the run stops. On
429, a Sightengine `usage_limit` or 5xx it retries the same page with exponential backoff
(`delayMs` × 2, 4, 8 …), up to 5 times in a row, then stops (`aborted_provider_unavailable`);
re-run it later and it picks up where it stopped.

**Cost and rate limits (Sightengine):** every image classified is one Sightengine operation
(model `nudity-2.1`), billed against the plan's monthly and daily quota; a dry run costs
nothing. Images are classified one at a time, `batchSize` (default 10) per batch, and each
batch reschedules itself `delayMs` (default 10 s) later: at most about 1 image per second,
~3,600 per hour. Before a real run, add up the dry runs' `candidates` and compare them with
what is left of the plan's quota (Sightengine dashboard → Usage). If it does not fit, run one
table at a time on different days, or lower the pace (for example `"batchSize":5,
"delayMs":30000`). Hitting the quota shows up as `usage_limit`: the run backs off and stops,
and nothing is lost.

**Safe to re-run:** yes. Scored rows are no longer candidates, so a second run only
picks up what is still unchecked.

**Commands:**

```bash
cd packages/backend

# 0. probe: one classification of a generated grey test image (no user data)
npx convex run admin/probePhotoScreening:probePhotoScreening
#    expect "config_status":"ok", "screening_outcome":"scored", "http_status":200

# dev: dry runs (the default: counts only, no classifier calls, no writes)
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"copy"}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"completion"}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"completionLegacy"}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"boxArt"}'
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"proposals"}'

# dev: the real runs, one table at a time (wait for "result":"done" in the logs)
npx convex run library/rescreenPhotos:rescreenPhotos '{"table":"copy","dryRun":false}'
# ...and the same for completion, completionLegacy, boxArt and proposals

# prod: same, after dev looks right (add --prod to each command, probe first)
npx convex run --prod admin/probePhotoScreening:probePhotoScreening
npx convex run --prod library/rescreenPhotos:rescreenPhotos '{"table":"copy"}'
```

The command returns the FIRST batch's counts; the remaining batches run as scheduled
functions. A dry run's `candidates` per batch is summed in the running `totals`. Each batch
logs one JSON line with `"event":"library.rescreenPhotos"`, the table, `dry_run`, the
`batch` and running `totals` (`scanned`, `candidates`, `approved`, `rejected`, `unscored`,
`skipped`, `quarantined`) and a `result` (`done`, `backoff`, `aborted_config`,
`aborted_provider_unavailable`). Follow it with `npx convex logs` (add `--prod`).

**Verify:**

1. The final line says `"result":"done"`, and `totals.candidates` matches the dry run.
2. A second dry run reports `candidates` close to 0. The remainder are images whose
   classification failed for that image, so they stay as they were.
3. The admin moderation console no longer shows the "Photo screening needs attention"
   warning (no unscored photos). Any new rejections of copy photos appear under Flagged
   Images; rejected completion photos and box art show in the Activity Log
   (`photo_auto_rejected`).

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
`threads.readReceipts`. The paged inbox and the bounded unread badge (PERF-B6m) read rows
without `lastActivityAt` or `unreadCount` from their own index range on every call (the
inbox up to 100 of them, each with its thread): confirm the backfill has run, or run it,
so those ranges are empty.

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
`catalog/sanitizeBoxArt`, WebP in the photo pipeline) and the orientation normalisation
(images turned upright instead of keeping an Exif Orientation) are deployed there. Before it, box art
was stored exactly as uploaded, and copy or completion photos in WebP (and rows older than
the moderation pipeline) kept their EXIF, so some stored images still carry GPS
coordinates, camera details or editor comments.

**What it does:** pages through one table, 25 rows per batch (`batchSize` overrides this),
downloads each image and looks for metadata blocks (Exif incl. GPS, XMP, IPTC, comments,
PNG text chunks, WebP EXIF/XMP). An image that carries any is stripped (every Exif block,
Orientation included) and turned upright, the same way new uploads are
(`lib/imageModeration/normaliseImage`):

- No Orientation (or Orientation 1): stripped at byte level, the pixels untouched.
- Orientation 2..8 (a phone photo stored sideways or mirrored): decoded, turned upright,
  scaled down to at most 1600 px on its long edge (as new uploads are; it bounds the action's
  memory) and re-encoded with no metadata at all. A JPEG stays JPEG (quality 95, no chroma subsampling,
  its RGB colour profile kept); a PNG stays PNG; a WebP becomes PNG when it has
  transparency, else JPEG (there is no WebP encoder on the server), and the new blob gets
  the matching content type. Box art cleaned by an earlier `sanitizeBoxArt` that kept an
  Orientation-only Exif block counts as carrying metadata, so it is turned upright too.
- An image that needs turning but is over the upload limits (10 MB, 12.54 MP; see
  `lib/imageModeration/guards`) or does not decode is still stripped at byte level (its GPS
  matters more than its rotation), just not turned; it then shows sideways.

The clean image is stored as a new blob, every row that pointed at the old blob is switched
to it, and the old blob is deleted once nothing references it. Clean images, GIFs and
images whose structure can't be parsed are left alone and counted.

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
`needsTurning`, `turned`, `clean`, `skipped`); the remaining batches run as scheduled
functions. `needsTurning` (counted in a dry run too) is how many of the images with metadata
hold an Orientation of 2..8; `turned` how many of those were stored upright. Each batch logs one
JSON line with `"event":"imageModeration.backfillStripMetadata"`, the table, `dry_run` and
the running totals; the line with `"done":true` carries the whole run's totals.

**Verify:** the real run's final `stripped` matches the dry run's `withMetadata`, its
`turned` matches the dry run's `needsTurning` (any difference was stripped but not turned),
and a second dry run reports `"withMetadata":0`. Download a few
switched images from the dashboard and check them with `exiv2 -pa` or `exiftool`: no
metadata at all, `Orientation` included; and open them in a browser: they show the right way
up.

## `lib/imageModeration/backfillBoxArtHashCheck` — CSAM hash check of existing box art

**When:** once per deployment that has the CSAM hash check configured
(`CSAM_HASHCHECK_PROVIDER=offlimits` plus the `OFFLIMITS_HCS_*` variables), after box art
through the shared moderation pipeline (`catalog/moderateBoxArt`) is deployed there. New box
art is hash-checked on upload; box art stored before that never was. On a deployment where
`backfillStripMetadata` has not run yet, run this one first: the strip replaces images that
still hold the bytes as uploaded, and those are what hash lists match. Without a configured
hash service a real run refuses to start (a dry run still counts).

**What it does:** pages through one table, 25 rows per batch (`batchSize` overrides this),
and for each box-art image whose `boxArtUploads` listing has not passed a hash check (or that
has no listing: box art from before the listing existed) downloads it and checks the MD5 +
SHA-1 of its stored bytes, exactly like the live pipeline:

- **match:** handled like a match on upload. The bytes are preserved as a new blob, the
  listing (created for legacy box art, attributed to the definition's submitter or the
  proposer) becomes `quarantined`, the box art is detached from every definition and
  proposal holding it (the puzzle then shows its placeholder), the original blob is deleted,
  and a `csamEscalations` row (table `boxArtUploads`, `originalDiscarded: true` because the
  stored bytes may not be the upload as sent) plus an `image_quarantined` audit stamp are
  raised. The operator reports it from Admin → Moderation as usual; the uploader is not told.
- **no_match:** recorded on the listing (`hashCheckedAt`), so a re-run skips it. The image
  keeps being served.
- **unavailable:** nothing changes (legacy box art stays served, as before) and it is
  counted; re-run once the hash service is back.

Box art the live pipeline owns (pending, quarantined, rejected) or that already passed a
check is skipped.

- `"table":"boxArt"`: `puzzles.image`.
- `"table":"proposals"`: `puzzleChangeProposals.changes.image` (proposed box art).

`dryRun` defaults to **true**: without `"dryRun":false` it only counts (`unchecked`) and calls
nothing outside. **Safe to re-run:** yes; checked box art is skipped.

```bash
cd packages/backend

# dev: dry runs (counts only), then the real runs
npx convex run lib/imageModeration/backfillBoxArtHashCheck:backfillBoxArtHashCheck '{"table":"boxArt"}'
npx convex run lib/imageModeration/backfillBoxArtHashCheck:backfillBoxArtHashCheck '{"table":"proposals"}'
npx convex run lib/imageModeration/backfillBoxArtHashCheck:backfillBoxArtHashCheck '{"table":"boxArt","dryRun":false}'
npx convex run lib/imageModeration/backfillBoxArtHashCheck:backfillBoxArtHashCheck '{"table":"proposals","dryRun":false}'

# prod: same, after dev looks right (add --prod to each command)
```

The command returns the FIRST batch's counts (`scanned`, `unchecked`, `noMatch`, `matched`,
`unavailable`, `skipped`); the remaining batches run as scheduled functions. Each batch logs
one JSON line with `"event":"imageModeration.backfillBoxArtHashCheck"`, the table, `dry_run`
and the running totals; the line with `"done":true` carries the whole run's totals. A match
logs its own `imageModeration.backfillBoxArtHashCheck.match` line carrying only the
escalation id.

**Verify:** the real run's final `noMatch + matched + unavailable` equals the dry run's
`unchecked`; with `unavailable` at 0, a second dry run reports `"unchecked":0`. Any
`matched` shows up as an open escalation under Admin → Moderation.

---

## `lib/imageModeration/recheckWaivedHashes` — hash check of photos published without one

**When:** on each deployment, **right after the CSAM hash check is configured there**
(`CSAM_HASHCHECK_PROVIDER=offlimits` plus the `OFFLIMITS_HCS_*` variables), and again whenever
admins have approved photos without a hash check during a later hash-service outage. It checks
two kinds of photo, and nothing re-checks either on its own:

- A photo whose hash check could not be done within 7 days goes to Admin → Moderation →
  Unchecked photos; an admin who publishes it with **Approve without hash check** leaves it
  marked `hashCheckWaivedBy` with its stored hashes (`pendingHashes`) (photo-moderation.md, "A
  timed-out photo: the admin decides").
- A photo uploaded while hash matching was switched off (provider unset or `none`) is
  published marked `hashCheckSkippedAt`, with its
  stored hashes (photo-moderation.md, "CSAM hash re-checks"). Photos published before that
  marker existed kept no hashes and cannot be checked.

Without a configured hash service a real run refuses to start (a dry run still counts).

**What it does:** pages through copy photos, completion photos, box art, message photos and
circle icons (`ownedPuzzleImages`, `completionImages`, `boxArtUploads`, `messageAttachments`,
`circleIcons`; 50 rows per batch, `batchSize` overrides this, max 100), in that order, or only
`table` (`"copy"`, `"completion"`, `"boxArt"`, `"message"` or `"circleIcon"`) when given. For
every photo with `hashCheckWaivedBy` or `hashCheckSkippedAt`, and `pendingHashes`, that is not
quarantined, it enqueues ONE re-check of the stored hashes on the hash re-check Workpool
(`hashRecheckWorkpool`, at most 2 at once, so the hash service gets a gentle stream). Each
re-check is decided exactly like a live one:

- **match:** quarantined and escalated like a match on upload, overriding the admin's
  approval: the bytes are preserved, the photo is quarantined (for a message photo: removed for
  both members), and a `csamEscalations` row plus an `image_quarantined` stamp are raised. The
  operator reports it from Admin → Moderation → Hash matches as usual; the uploader is not told.
- **no_match:** recorded (`hashCheckedAt`), and `pendingHashes` and `hashCheckWaivedBy` or
  `hashCheckSkippedAt` cleared: the photo counts as hash-checked and is not a candidate again.
  It stays published.
- **unavailable** or an error: nothing changes and nothing is re-armed; the photo stays a
  candidate for the next run.

`dryRun` defaults to **true**: without `"dryRun":false` it only counts the candidates (`waived`,
both kinds together) and enqueues nothing; the hash service is never called. On prod, where
hash matching is off, every photo uploaded since the marker shipped is a candidate, so expect
the first run to take a while; the pool drains it two re-checks at a time. **Safe to re-run:** yes; checked and
quarantined photos are no longer candidates. Let the pool drain before re-running (a re-run
re-enqueues a photo whose check is still queued; the older job then does nothing).

```bash
cd packages/backend

# dev: dry run (counts only), then the real run
npx convex run lib/imageModeration/recheckWaivedHashes:recheckWaivedHashes '{}'
npx convex run lib/imageModeration/recheckWaivedHashes:recheckWaivedHashes '{"dryRun":false}'

# prod: same, after dev looks right
npx convex run --prod lib/imageModeration/recheckWaivedHashes:recheckWaivedHashes '{}'
npx convex run --prod lib/imageModeration/recheckWaivedHashes:recheckWaivedHashes '{"dryRun":false}'
```

The command returns the FIRST batch's `{ scanned, waived, enqueued }`; the remaining batches
run as scheduled functions. Each batch logs one JSON line with
`"event":"imageModeration.recheckWaivedHashes"`, the table, `dry_run`,
`csam_hashcheck_provider` and the running totals; the line with `"done":true` carries the whole
run's totals. Every re-check logs its own `<table event>.hashRecheck` line (for example
`library.moderatePhoto.hashRecheck`) with `csam_hashcheck_status`.

**Verify:**

1. The real run's final `enqueued` equals its `waived`, and the dry run's `waived`.
2. Once the pool has drained (no new `.hashRecheck` lines), a second dry run reports
   `"waived":0`, or the number of photos whose check came back `unavailable` (re-run those
   later).
3. Any match shows up as an open escalation under Admin → Moderation → Hash matches, and in the
   Activity Log as `image_quarantined`.

---

## `solving/backfillLegacyCompletionSidecars` — make legacy completion photos visible as blob references (SEC-92)

**When:** once per deployment, any time after this code is deployed there. Run it before
`catalog/findDanglingBoxArt` (below) and before the storage sweep is ever switched to delete
mode. Until it has run, a completion photo stored before the `completionImages` sidecars existed
lives only in its completion's `photos` array, which no index reaches: the claim rule, the
reference-aware deletes and the storage sweep cannot see that its blob is in use.

**What it does:** pages through `completions` (50 rows per batch, each batch its own
transaction, rescheduling itself until the table is exhausted). For every photo of a completion
that has an `aggregateId` and no `completionImages` row for that photo, it inserts the sidecar
the re-screen would create (`completionId`, `uploaderId` = the completion's member, `fileId`,
`createdAt`, `updatedAt`; no moderation status and no hash-check fields). Every read model serves
such a row exactly like the photo without one, so nothing changes for members; the re-screen
still classifies the photo. Photos that already have a sidecar are left alone. A completion
without an `aggregateId` cannot have a sidecar: it is counted (`without_aggregate_id`) and so are
its photos (`photos_without_aggregate_id`).

`dryRun` **defaults to true**: without `"dryRun":false` it only counts.

A real run that starts at the beginning of the table (no `cursor` passed) and ends with
`photos_without_aggregate_id` 0 records a `legacyCompletionSidecars` row in `maintenanceMarkers`
(its final event shows `"marker_recorded":true`). A completion without an `aggregateId` and
without photos holds no blob, so it does not stop the marker. The storage sweep stays a dry run
until that row exists, even when `STORAGE_GC_MODE` is `delete` (photo-moderation.md, "Storage
sweep").

**Safe to re-run:** yes. A second real run creates 0 sidecars.
## `library/backfillCopyOpenFlag` — the listing flag Browse reads by index
## `library/backfillCopyOpenFlag` — the listing fields Browse reads by index

**When:** once per deployment, after the `ownedPuzzles` listing fields (`isOpen`,
`listedAt`, `ownerPrivate`) and their `by_listing` / `by_puzzle_listing` indexes (PERF-B1m,
SEC-29) are deployed there. There is no ordering pressure: every copy save, every settled
exchange and every profile visibility change already writes the fields, and until a row has
them, Browse still finds it through a fallback that reads the rows without a flag and checks
their availability and owner. That fallback reads legacy closed copies and private members'
copies too, and they count against Browse's read budget (3,000 rows per call), so on a
deployment with more copies than that Browse can miss older listings until the backfill has
run. Run it soon after the deploy; once it has run, the fallback range is empty and Browse
reads only public members' open copies.

**What it does:** pages through `ownedPuzzles` (200 rows per batch; `batchSize` overrides
it, rounded down and clamped to 1..1000; each batch its own transaction, rescheduling itself
until the table is exhausted) and writes, on every row whose fields are absent (`set`) or
disagree with its availability or owner (`repaired`): `isOpen` = "at least one of
`forTrade`, `forSale`, `forLend` is set"; `listedAt` = when it was offered, kept if present
and otherwise its `createdAt` (so Browse's order is today's), absent while closed;
`ownerPrivate` = `true` while the owner's profile is private, absent otherwise. Rows already
in step are left alone. It writes only those fields (not `updatedAt`: this is not an owner
edit).

**Safe to re-run:** yes. A second run finds every row in step and writes nothing. It also
doubles as a repair: if a future write path changes `availability` or the owner without the
fields, a re-run corrects those rows (`repaired` > 0 points at that bug).

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only), then the real run
npx convex run solving/backfillLegacyCompletionSidecars:backfillLegacyCompletionSidecars '{}'
npx convex run solving/backfillLegacyCompletionSidecars:backfillLegacyCompletionSidecars '{"dryRun":false}'

# prod: same, after dev looks right
npx convex run --prod solving/backfillLegacyCompletionSidecars:backfillLegacyCompletionSidecars '{}'
npx convex run --prod solving/backfillLegacyCompletionSidecars:backfillLegacyCompletionSidecars '{"dryRun":false}'
```

The command returns the FIRST batch's running totals; the remaining batches run as scheduled
functions. Every batch logs a `solving.backfillLegacyCompletionSidecars` wide event with
`dry_run`, `done`, `from_start`, `marker_recorded` and the running totals `completions`,
`photos`, `created`, `existing`, `without_aggregate_id` and `photos_without_aggregate_id`; the
event with `"done":true` carries the whole run. Follow it with `npx convex logs` (add `--prod` for prod) or in the dashboard Logs.

**Verify:**

1. The real run's final `created` matches the dry run's (give or take photos attached in
   between, which get their sidecar at attach time).
2. Run the dry run again: its final event shows `"created":0`.
3. Note `without_aggregate_id` and `photos_without_aggregate_id`. `photos_without_aggregate_id`
   must be 0 before the storage sweep may delete blobs; the real run's final event shows
   `"marker_recorded":true` exactly when it was. If it is not 0, run
   `solving/backfill:backfillSolving` (it stamps an `aggregateId` on every completion and goal
   that lacks one, and skips rows that have one), then this backfill again, dry run and then real:

   ```bash
   npx convex run solving/backfill:backfillSolving '{}'   # add --prod for prod
   ```

   `without_aggregate_id` alone (completions without photos) does not block the sweep.

4. Spot-check an old completion with photos: its photos still show on the member's profile and
   in their completion history.

---

## `catalog/findDanglingBoxArt` — was box art already destroyed? (SEC-01, read-only)

**When:** once per deployment, after the SEC-01 fixes (claim-once photo attach, reference-aware
deletes, no storage ids in responses) are deployed there. Before those fixes any member could
read a definition's box-art storage id, attach it as their own copy or completion photo and
have it deleted. This check tells whether that already happened. For the fullest picture, run
`solving/backfillLegacyCompletionSidecars` first: completion photos that predate their
`completionImages` sidecar are only seen once they have one.

**What it does:** pages through `puzzles` (you pass the page size and cursor) and reports, per
page:

- `missingImage`: definitions whose `image` names a blob that no longer exists. The art was
  destroyed and has to be uploaded again. Admin → Puzzles marks these rows **Box art missing**;
  open the row, then edit the definition and upload the art.
- `heldByMemberRows`: box art that another kind of row also holds (`heldBy`: for example
  `copyPhoto`, `completionPhoto`, `messagePhoto`, or `definitionBoxArt` when a second definition
  names the same blob). The art still exists; the holding row was attached before the claim
  rule existed. Since the reference-aware deletes, removing that photo no longer deletes the
  box art, so the art is safe; note the member if the pattern looks deliberate.

It writes nothing. **Safe to re-run:** yes.

```bash
cd packages/backend

# dev, then prod: repeat with the returned continueCursor until "isDone":true
npx convex run catalog/findDanglingBoxArt:findDanglingBoxArt '{"paginationOpts":{"numItems":100,"cursor":null}}'
npx convex run catalog/findDanglingBoxArt:findDanglingBoxArt '{"paginationOpts":{"numItems":100,"cursor":"<continueCursor>"}}'

npx convex run --prod catalog/findDanglingBoxArt:findDanglingBoxArt '{"paginationOpts":{"numItems":100,"cursor":null}}'
```

Each page returns `{ scanned, missingImage, heldByMemberRows, isDone, continueCursor }`.

**Verify:** the pages' `scanned` add up to the number of `puzzles` rows. Both lists empty on
every page means SEC-01 was never used on that deployment. After restoring art for every
`missingImage` hit, a second run reports none, and no row in Admin → Puzzles shows **Box art
missing**.

---

## `lib/imageModeration/clearSettledHashPending` — take settled photos out of the hash-pending index

**When:** once per deployment, after the code that clears `hashCheckPendingSince` on refused and
quarantined photos is deployed (SEC-55). Optional: nothing is wrong while those rows remain (the
admin counts skip them), but the admin's Hash matches count, the uploader's "box art in check"
list and the daily hash re-check sweep keep scanning them.

**What it does:** pages through the `by_hash_check_pending` index of copy photos, completion
photos, box art, message photos and circle icons (50 rows per batch, `batchSize` overrides this,
max 100), in that order, and clears `hashCheckPendingSince` (nothing else) on a row that waits on
nothing any more:

- **quarantined** (a hash match; it is never served, whatever its fields say);
- **refused:** rejected with label `invalid_image`, no stored hashes (`pendingHashes`), and its
  blob gone.

Everything else keeps the field: photos still waiting on their check or not reached by the
pipeline yet, timed-out photos (with or without an admin decision; for one an admin rejected,
the field keeps its gate closed should it be restored), and a refused row whose blob is still
stored. Clearing the field never publishes anything.

`dryRun` defaults to **true**: without `"dryRun":false` it only counts (`settled`) and writes
nothing. **Safe to re-run:** yes; a cleared row is no longer in the index, so a second run reports
`"settled":0`.

```bash
cd packages/backend

# dev: dry run (counts only), then the real run
npx convex run lib/imageModeration/clearSettledHashPending:clearSettledHashPending '{}'
npx convex run lib/imageModeration/clearSettledHashPending:clearSettledHashPending '{"dryRun":false}'

# prod: same, after dev looks right
npx convex run --prod lib/imageModeration/clearSettledHashPending:clearSettledHashPending '{}'
npx convex run --prod lib/imageModeration/clearSettledHashPending:clearSettledHashPending '{"dryRun":false}'
```

The command returns the FIRST batch's `{ scanned, settled, cleared }`; the remaining batches run
as scheduled functions. Each batch logs one JSON line with
`"event":"imageModeration.clearSettledHashPending"`, the table, `dry_run` and the running
totals; the line with `"done":true` carries the whole run's totals.

**Verify:** the real run's final `cleared` equals the dry run's `settled`, and a second dry run
reports `"settled":0`.
# dev: dry run (counts only, writes nothing), then the real run
npx convex run library/backfillCopyOpenFlag:backfillCopyOpenFlag '{"dryRun":true}'
npx convex run library/backfillCopyOpenFlag:backfillCopyOpenFlag '{}'

# prod: same, after dev looks right
npx convex run --prod library/backfillCopyOpenFlag:backfillCopyOpenFlag '{"dryRun":true}'
npx convex run --prod library/backfillCopyOpenFlag:backfillCopyOpenFlag '{}'
```

The command returns the FIRST batch's `{ scanned, set, repaired, inStep }`; the remaining
batches run as scheduled functions. Each batch logs one JSON line with
`"event":"library.backfillCopyOpenFlag"`, `dry_run`, the batch counts and the running
`totals`; the line with `"is_done":true` carries the whole run's totals.

**Verify:**

1. The real run's final `totals.set + totals.repaired` matches the dry run's (give or take
   copies saved in between, which already carry the flag).
2. Run the dry run again: its final totals show `"set":0` and `"repaired":0`.
3. In the dashboard data view, every `ownedPuzzles` row has `isOpen`, and it is `true`
   exactly when one of its availability flags is; open rows have `listedAt`, and rows of
   members with a private profile have `ownerPrivate: true`.
4. Browse lists the newest offers first, including copies added after the oldest 500.

---

## `social/backfillActivityEntries` — the activity feed's per-actor read model

**When:** once per deployment, after the `activityEntries` and `readModelStatus` tables and
the dispatcher's `activityFeed` handler (SEC-30, PERF-B3m) are deployed there. There is no
ordering pressure: every feed event dispatched after the deploy is projected by the
dispatcher, and until this backfill has finished the feed keeps reading `domainEvents` the
old way (a global newest-500-per-event-name window, at the old cost and with the old
crowding-out problem). The last batch of a real run writes the `readModelStatus` row
`activityEntries`, which switches the feed to the read model; run it soon after the deploy.

**What it does:** walks `domainEvents` through `by_name` for the feed's four events
(`CompletionRecorded`, `CompletionStarted`, `CopyAcquired`, `ExchangeCompleted`) in turn,
limited to the feed's 90-day window (fixed when the run starts; older events never reach a
feed). 200 events per batch (`batchSize` overrides it, rounded down and clamped to 1..1000;
each batch its own transaction, rescheduling itself until the last name is exhausted). Each
event goes through the dispatcher's own projection: one `activityEntries` row per (actor,
kind, ref), a batch add folded into one row, nothing for undated, year-only or bulk solves,
and nothing for a deleted member.

**Safe to re-run:** yes. Rows that already exist are left alone (a batch row only gains
copies it does not list yet), so a second run reports `"inserted":0` and `"updated":0`. It
also repairs rows the dispatcher missed, for example an event whose `activityFeed` handler
gave up after its retries (it shows up in `failedHandlers`).

**Commands:**

```bash
cd packages/backend

# dev: dry run (counts only, writes nothing, does not switch the feed), then the real run
npx convex run social/backfillActivityEntries:backfillActivityEntries '{"dryRun":true}'
npx convex run social/backfillActivityEntries:backfillActivityEntries '{}'

# prod: same, after dev looks right
npx convex run --prod social/backfillActivityEntries:backfillActivityEntries '{"dryRun":true}'
npx convex run --prod social/backfillActivityEntries:backfillActivityEntries '{}'
```

The command returns the FIRST batch's `{ events, inserted, updated }`; the remaining batches
run as scheduled functions. Each batch logs one JSON line with
`"event":"social.backfillActivityEntries"`, `dry_run`, `event_name`, the batch counts and the
running `totals`; the line with `"is_done":true` carries the whole run's totals. A dry run
cannot see rows it did not write, so it counts the later copies of a batch add as `inserted`
where the real run counts them as `updated`; `inserted + updated` matches.

**Verify:**

1. The real run's final `totals.events` matches the dry run's (give or take events recorded
   in between, which the dispatcher already projected).
2. Run the dry run again: its final totals show `"inserted":0` and `"updated":0`.
3. In the dashboard data view, `readModelStatus` has a row with `name` `activityEntries`.
4. The dashboard pulse and /people feed show the same entries as before the run.

---

## `insights/platformStats:recount` — the landing page's counters

**When:** once per deployment, right after the `platformStats` table and the
`recount platform stats` cron (PERF-B2m) are deployed there. Optional: the cron runs the
same recount every 6 hours. There is no ordering pressure: until the first recount has
written the row, `insights/getGlobalStats` counts the `users`, `puzzles` and
`ownedPuzzles` tables itself, at the old full-table cost on every home page load, so run it
soon after the deploy rather than waiting for the cron.

**What it does:** pages through `users`, then `puzzles`, then `ownedPuzzles` (1000 rows per
batch; `batchSize` overrides it, rounded down and clamped to 1..4000; a batch also stops
after reading 4 MiB; each batch its own transaction, rescheduling itself until the last
table is exhausted) and counts every row, with the meaning the landing page always had
(deactivated members and definitions in any status included). The last batch writes the
single `platformStats` row (`key` `global`) with the three counts and `countedAt`. It reads
nothing else and writes only that row.

**Safe to re-run:** yes. Each run rewrites the same row with fresh counts. Two runs at once
(a manual run during the cron) each write a complete count; the later one stays.

**Commands:**

```bash
cd packages/backend

# dev, then prod
npx convex run insights/platformStats:recount '{}'
npx convex run --prod insights/platformStats:recount '{}'
```

The remaining batches run as scheduled functions. The last batch logs one JSON line with
`"event":"insights.platformStats.recount"`, the `counts` and `counted_at`.

**Verify:**

1. In the dashboard data view, `platformStats` has one row with `key` `global`.
2. Its counts match the row counts the dashboard shows for `users`, `puzzles` and
   `ownedPuzzles` (give or take rows written while it ran).
3. The home page shows the same numbers as before the run.

---

## `library/definitionStats:reconcile` — the catalog and definition pages' aggregates

**When:** once per deployment, right after the `definitionStats` table, the marks on the
write paths and the `reconcile definition stats` cron (PERF-B4m, SEC-29) are deployed there.
Optional: the cron runs the same reconcile every night. There is no ordering pressure:
every write that changes a definition's aggregates already gives it a row, and until a
definition has one the catalog and definition pages compute its aggregates themselves, at
the old cost (every review, copy and completion of the definition on each view), so run it
soon after the deploy rather than waiting for the cron.

**What it does:** pages through `puzzles` (100 definitions per batch; `batchSize` overrides
it, rounded down and clamped to 1..500; each batch its own transaction, rescheduling itself
until the table is exhausted) and schedules one `library/definitionStats:recompute` per
definition. Each recompute is its own transaction: it reads the definition's reviews, copies
and completions (and the profile visibility of the copies' owners), computes the totals the
pages show with the same helpers they used to run live, and writes the definition's
`definitionStats` row only when its totals changed. It never writes any other table.

**Safe to re-run:** yes. A second run finds every row in step and writes nothing. It also
doubles as a repair: a row whose totals differ from its sources without having been marked
stale is rewritten and logged as `"event":"library.definitionStats.drift"` with its
`puzzle_id`. A drift line points at a write path that changes reviews, copies, completions
or profile visibility without marking the definition (see library/definitionStats).

**Commands:**

```bash
cd packages/backend

# dev, then prod
npx convex run library/definitionStats:reconcile '{}'
npx convex run --prod library/definitionStats:reconcile '{}'
```

The remaining batches and the per-definition recomputes run as scheduled functions. The
last batch logs one JSON line with `"event":"library.definitionStats.reconcile"` and the
number of `definitions` it scheduled.

**Verify:**

1. In the dashboard data view, `definitionStats` has one row per `puzzles` row, each with
   `totals` and without `stale`.
2. Run it again: no `library.definitionStats.drift` lines, and no row's `computedAt`
   changes (give or take definitions written to in between).
3. The public catalog, a catalog detail page and a `/puzzles/<id>` page show the same
   ratings, owner, completion and availability numbers as before the run.
