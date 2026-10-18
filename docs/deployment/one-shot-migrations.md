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
keeps it inside the Hugging Face free-tier rate limits.

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
