# Photo moderation: retries, crashed checks and stalled photos (runbook)

Every uploaded photo (copy photos, completion photos, box art, message photos and circle icons) is
checked by
the shared pipeline in `packages/backend/convex/lib/imageModeration/pipeline.ts`. This page covers
how a check is retried, what happens when one never finishes, and what to watch. No manual step is
needed when this ships.

## How a check runs

- Every check is a job on one Convex Workpool, the `moderationWorkpool` component
  (`@convex-dev/workpool`, registered in `convex/convex.config.ts`; the pool itself is
  `lib/imageModeration/moderationPool.ts`). Uploads, an admin's **Check again**
  (`admin/recheckPhoto`) and an admin's restore of a message photo (`admin/decideImageReview`)
  enqueue it. Box art runs its first attempt inline while the uploader waits
  (`catalog/moderateBoxArt.checkBoxArt`) and hands an undecided one to the pool.
- **Parallelism:** at most 4 checks at once (`MODERATION_POOL_PARALLELISM`). Each is one
  classifier call plus an in-memory decode and re-encode.
- **Attempts:** 4 per check (`MODERATION_MAX_ATTEMPTS`), counted on the row as
  `moderationAttempts`. A retryable failure (rate limit, 5xx, network, a blob that could not be read
  or swapped) on attempts 1 to 3 makes the job throw, and the pool runs it again about 1, 5 and
  25 minutes later (with jitter). A definite result (approved, rejected, refused, quarantined, or
  unscored for a configuration problem such as a missing token) is never retried. On the 4th
  attempt the pipeline records the verdict itself: `unscored` with the classifier's reason.
- **Crashed attempts:** an attempt that dies mid-run (action timeout, runtime restart, deploy) is
  found by the pool's recovery scan (about every minute, for jobs started over 5 minutes ago) and
  counted as a failed attempt, so it is retried like any other failure. The pool allows one spare
  attempt for this.
- **When the retries run out:** the pool's callback (`moderationPool.onModerationComplete`) stamps
  a photo that is still `pending` as `unscored`, with the classifier's reason when the last attempt
  was one of ours, or `check_failed` (crash, timeout, cancel). A photo that already has a verdict
  is left alone.
- **Backstop:** a daily cron (`convex/crons.ts`, 03:30 UTC) runs
  `lib/imageModeration/stalledSweep.sweepStalledModeration` over every moderated table. A photo still
  `pending` 24 hours after it was last touched (`updatedAt`; box art: `recheckedAt`, else
  `createdAt`) is stamped `unscored` with reason `stalled`. It reads only rows created before the
  cutoff, through the `by_moderation_status` index, one page of 100 per run, and stamps through
  each table's own verdict mutation, so re-running it changes nothing.

An `unscored` copy photo, completion photo, box art or circle icon appears in **Admin → Moderation → Unchecked
photos** with its reason ("The check did not complete", "Still unchecked after 24 hours", or the
classifier's reason), where an admin can **Check again**, approve or reject it. An `unscored`
message photo is delivered blurred and labelled "Not checked", as before.

## CSAM hash re-checks

When the CSAM hash service cannot answer ("unavailable"), the pipeline stores the MD5 + SHA-1 of the
original and the re-encode on the row (`pendingHashes`), carries on with classification, and keeps
the photo unpublished: no URL is issued, to anyone, until a hash check has passed. Those stored
hashes are then checked again by `lib/imageModeration/hashRecheckPool.ts`:

- **Schedule:** 15 and 30 minutes, 1, 2, 4, 8 and 16 hours, then every 24 hours
  (`HASH_RECHECK_DELAYS_MS`), until the photo times out (below). no_match publishes it; a match
  quarantines it and raises a CSAM escalation exactly like a match on upload (the bytes are
  preserved under a new blob, and the uploader is told nothing).
- **Timeout after 7 days** (`HASH_CHECK_TIMEOUT_MS`, counted from `hashCheckPendingSince`): when a
  re-check would be armed for a photo that has waited that long, the chain stops instead. The row
  is stamped `hashCheckTimedOutAt`, stays unpublished, keeps its stored hashes, and goes to
  **Unchecked photos** as "Hash check timed out" (every table: copy photos, completion
  photos, box art, sent message photos and circle icons). The last re-check runs a little over 7 days in. This
  happens wherever a re-check would be armed: after an "unavailable" answer, after the pool gives
  up, and in the daily sweep (a lost photo past 7 days times out rather than being re-armed).
- **Its own Workpool**, the `hashRecheckWorkpool` component, separate from the moderation pool: at
  most 2 re-checks at once (`HASH_RECHECK_POOL_PARALLELISM`). The re-checks talk to the hash
  service, whose limits are not the classifier's. After an outage every waiting photo's re-check
  comes due together, and that backlog must not take the 4 classifier slots that uploads need.
- **One current re-check per photo:** the row records the current attempt and when it is due
  (`hashRecheckAttempt`, `hashRecheckDueAt`). A re-check is armed with a compare-and-set on that
  attempt, in the same transaction as the enqueue, so a re-check that runs twice arms only one
  next attempt. A job whose attempt is no longer the row's does nothing.
- **Crashes:** a re-check that throws or crashes (timeout, restart, deploy) is retried by the pool
  about 1 and 5 minutes later (`HASH_RECHECK_RETRY`, 3 tries). When the pool gives up,
  `onHashRecheckComplete` arms the next attempt on the schedule, as if the service had answered
  "unavailable". The photo stays waiting and is never left without a re-check.
- **Backstop:** a daily cron (03:45 UTC) runs `hashRecheckPool.sweepLostHashRechecks` over every
  moderated table (the `by_hash_check_pending` index, 100 rows per run). It re-arms, to run at once, a
  waiting photo that has no re-check armed, or whose current one was due more than 24 hours ago.
  A timed-out photo is not waiting any more and is left alone.

### A timed-out photo: the admin decides

The admin sees the photo (behind the usual blur-until-reveal guard, admins only, as for any
unchecked photo) and decides it with `admin/decideUncheckedPhoto`, whatever the classifier said:

- **Approve without hash check** (decision `waive_hash_check`; a button of its own that first asks
  for confirmation in a dialog saying what it does) publishes it **without a hash check**:
  `hashCheckedAt` is set (the gate opens), `hashCheckWaivedBy` records the admin, and the audit
  trail stamps `photo_hash_check_waived` ("approved a photo without a hash check"), not the usual
  manual approval. A message photo the classifier blurred stays blurred. The normal **Approve** is
  not offered for a timed-out photo, and the server refuses it (`approve` on a timed-out row, and
  `waive_hash_check` on any row that did not time out, both throw), so a hash check is never skipped
  by the ordinary approval.
- **Reject** is the table's usual manual rejection (a copy photo moves to Flagged Images, a
  completion photo and box art are detached and deleted, a circle icon is deleted and the circle
  keeps its previous icon, a message photo is removed by moderation and its sender told). A rejected timed-out copy photo shows its image in **Flagged Images** to
  admins (behind the same blur-until-reveal guard; `listRejectedPhotos` is admin-only), marked as
  timed out. **Restore Photo** there does not publish it: the hash gate stays closed, so it turns
  "approved" but unchecked and goes back to **Unchecked photos** as "Hash check timed out", where
  only Approve without hash check publishes it (the console says so before and after restoring).

Who wins when answers cross (every step is one Convex transaction, so the first to commit wins):

- **A match always wins.** The stored hashes are kept after an approval, and a re-check that still
  runs (a lost job that turns up, a pool retry) is honoured: a match quarantines the photo and
  raises the escalation even after an admin approved it. The approval cannot stop that, and once
  the photo is quarantined the admin can no longer decide it.
- A **no_match** that arrives before the admin decides publishes the photo as usual and takes it
  out of the queue. After an admin decision it changes nothing (an approved photo is already
  public; a rejected one stays rejected).
- Nothing re-checks a timed-out photo on its own: once the hash service is back, photos approved
  without a hash check are **not** re-checked automatically. They carry `hashCheckWaivedBy` and
  their `pendingHashes`, and the one-shot `lib/imageModeration/recheckWaivedHashes` checks them
  (one re-check each on the hash re-check pool; a match quarantines and escalates over the
  approval, a no_match is recorded and clears `hashCheckWaivedBy` and `pendingHashes`). **Run it
  right after configuring Offlimits** on a deployment (dry run first); see
  [one-shot-migrations.md](one-shot-migrations.md#libimagemoderationrecheckwaivedhashes--hash-check-of-photos-published-without-one).
  A re-check of a waived photo never runs against an unconfigured service (it is skipped,
  `result: "skipped_unconfigured"`): an unconfigured service cannot answer.

What admins see: a photo waiting on its hash check is counted on **Admin → Moderation → Hash
matches** ("No hash-check answer yet: N photos waiting, unpublished", with the oldest wait). While it
waits it is not in **Unchecked photos** when the classifier approved it: there is nothing for an
admin to decide yet, and nobody can publish it before the hash check passes. A waiting photo that
the classifier could not score does appear there, without a preview, and cannot be approved or
rejected until its hash check has passed or timed out. A timed-out photo is listed there once, as
"Hash check timed out" with its image (read through the `by_hash_check_timed_out` index, with the
already-decided ones filtered out before the queue limit, so rejected timed-out rows never crowd
out undecided ones, and timed-out rows never take the place of ordinary unscored ones), counted
in the tab badge, and counted apart on **Hash matches** ("Hash check timed out: N photos ...
need an admin decision"). No notification is sent:
the admin notifications are built on member-facing domain events, so the tab count plus the
`imageModeration.hashCheckTimedOut` error event (below) are the alert. The 24-hour stalled sweep
only looks at photos whose classifier check is still `pending`, so it leaves a photo that is only
waiting on its hash check alone.

The hash check is not configured on dev or prod today (`CSAM_HASHCHECK_PROVIDER` unset means
"none"), so no photo waits and none of this runs until it is. Without it the hash service is
never asked and **nothing is recorded as hash-checked**: the pipeline publishes each photo as
before, but marks it "not hash-checked" (`hashCheckSkippedAt`; the wide event says
`csam_hashcheck_status: "skipped"`) and keeps the hashes of the original and the re-encode
(`pendingHashes`), so it can still be checked once the service is configured. `offlimits` with a
credential missing is not "off" but an outage: the operator meant checks to run, so photos are
held unpublished exactly as when the service is unreachable (re-checked for up to 7 days, then
handed to an admin), and every attempt logs at error level (`csam_hashcheck_config:
"missing_config"`, `csam_hashcheck_status: "unavailable"`). This is decided in one place
(`csamHashCheck.skipsHashCheck`). A photo still waiting on a re-check when matching is switched
off is published the same way by that re-check. Photos published before this marker
existed kept no hashes and cannot be checked after the fact. Once the service is configured,
`lib/imageModeration/recheckWaivedHashes` checks these photos as well as the waived ones (a match
quarantines and escalates, a no_match clears the marker); a re-check of one never runs against
an unconfigured service (`result: "skipped_unconfigured"`). The admin escalations query
(`admin/listCsamEscalations`, `hashCheck.uncheckedPhotos`, `uncheckedSince`, `uncheckedCapped`)
counts them per table through the `by_hash_check_skipped` index, capped at 200 per table. The
index needs no backfill: only rows published after this change carry the marker.
**Admin → Moderation** shows this state in a red banner at the top of the page
(`HashCheckHealth`): "CSAM hash matching is OFF" (provider unset), "OFF: selected but not
configured" (with the missing variable names; new photos are held), or "unreachable", with the
count of photos held unpublished, plus the count of photos uploaded without a hash check and the
date of the oldest. That count is of uploads, not of published photos: it includes photos the
classifier rejected or a moderator removed later, which a later check still covers. Once matching
works and that count reaches zero, the banner disappears. When it is configured, run `lib/imageModeration/recheckWaivedHashes` right after (above), and
`lib/imageModeration/backfillBoxArtHashCheck` for older box art (one-shot-migrations.md).

## Storage sweep: blobs nothing holds (dry run until the owner enables it)

Uploads are claimed once and the delete paths keep a blob that another row still holds, so a blob
nobody holds stays in storage whenever an upload is never attached (a form left unsaved, an attach
that was refused or came too late, a burst of upload URLs). A daily cron (04:15 UTC) runs
`lib/storage/storageSweep.sweepStorage` over the `_storage` rows of the last 10 days
(`scope: "recent"`), where nearly every such blob is, and a monthly cron (the 1st, 05:15 UTC) over
the whole table (`scope: "all"`), which finds an older blob something has since let go of. Both go
50 blobs per batch, each batch its own transaction, rescheduling itself until done. For each blob:

- **Younger than 24 hours** (`ORPHAN_MIN_AGE_MS`): kept. An upload may still be attached (the claim
  windows are 15 minutes).
- **Held by any blob reference** (`lib/imageModeration/blobReferences.blobReferenceKinds`: a copy,
  completion or message photo, a message thumbnail or location map, a circle icon, a definition's
  box art, a proposal's proposed box art, report evidence, an image rendition, or a CSAM escalation
  that preserves it): kept. A box-art listing (`boxArtUploads`) holds its blob too, with the
  exception below. A rendition is kept only as long as its source: deleting a blob also deletes its
  renditions (`renditionsStore.deleteRenditions`), which are not counted as candidates of their own.
- **Held by nothing:** a candidate (`orphans`).
- **Held only by its box-art listing** (no definition shows it, no proposal proposes it), at least
  7 days old (`UNATTACHED_BOX_ART_TTL_MS`), and its checks are over (not `pending`, not
  `quarantined`, hash check passed, and no hash re-check still owed after an admin waived it): a
  candidate (`unattached_box_art`). In delete mode its listing row is deleted with it, so no catalog
  form can name the art afterwards. A proposal's `baseline.image` (what the definition showed when
  the proposal was filed) does not keep it: it is compared for conflicts, and its URL is sent only
  while the blob exists.

**Mode:** a dry run, unless the deployment environment variable `STORAGE_GC_MODE` is exactly
`delete`. A dry run deletes nothing; it only logs what it would delete. The mode is read on every
batch: removing the variable stops deletion from the next batch on. Setting it is an owner
decision, made in the Convex dashboard (**Settings → Environment Variables**) or with
`npx convex env set STORAGE_GC_MODE delete`.

Delete mode also needs the legacy completion photos backfilled, and the code enforces it: until
`solving/backfillLegacyCompletionSidecars` has finished a real run over the whole table with no
photo on a completion lacking an `aggregateId` (precondition 1 below), the sweep stays a dry run
even when `STORAGE_GC_MODE` is `delete`, and every `storage.sweep` event carries
`"delete_blocked":"legacy_completion_sidecars_not_backfilled"`. That run records a
`legacyCompletionSidecars` row in the `maintenanceMarkers` table, and the sweep looks for it.

**Before switching to delete mode** (on each deployment, dev first):

1. `solving/backfillLegacyCompletionSidecars` has run for real, and a fresh dry run of it reports
   `"created":0` and `"photos_without_aggregate_id":0` (one-shot-migrations.md; if the second is
   not 0, run `solving/backfill:backfillSolving` first, then the backfill again). Until then a
   completion photo stored before the sidecars existed is held only by the unindexable
   `completions.photos` array, so the sweep sees its blob as held by nothing and would **delete a
   member's photo**. (The sweep refuses delete mode until the real run has recorded its marker;
   see above.)
2. `blobReferences.test.ts` is green on the code being deployed: every `v.id("_storage")` field in
   the schema is registered as a blob reference or reviewed as not one. A new storage-id field (for
   example image renditions) must be registered before the sweep may delete.
3. At least 7 daily dry runs and one over the whole table (the monthly cron, or by hand:
   `npx convex run lib/storage/storageSweep:sweepStorage '{"scope":"all"}'`), whose `storage.sweep`
   events show only expected candidates (spot-check a few `batch_candidate_ids` in the dashboard's
   **Files** view: abandoned uploads, never-used box art) and no unexpected kinds in `kept_by_kind`.

Each batch logs one `storage.sweep` wide event: `scope` (`recent` or `all`), `mode` (`dry_run` or `delete`), `delete_blocked`
(only when delete mode was asked for but refused), `done`,
`started_at`, `batch_scanned`, `batch_candidate_ids`, and the run's running totals (`scanned`,
`scanned_bytes`, `young`, `kept`, `kept_by_kind`, `candidates`, `candidate_bytes`, `orphans`,
`unattached_box_art`, `candidate_content_types`, `deleted`, `deleted_bytes`). The event with
`"done":true` carries the whole run.

```
['jigswap'] | where event == "storage.sweep" and done == true | project _time, scope, mode, scanned, kept, candidates, candidate_bytes, orphans, unattached_box_art, deleted, kept_by_kind
```

A blob the sweep deletes is gone for the app (only a Convex backup that includes file storage
could bring it back), so the dry-run week is the safety net.

## Rollout: checks in flight at deploy time

Retries scheduled by the previous code (`moderatePhoto` and friends with an `attempt` argument)
still run after the deploy: the actions keep accepting `attempt`, ignore it, and hand a retry to
the pool instead of scheduling one. A row whose old retry chain was lost before the deploy is
stamped `stalled` by the first daily sweep after it is 24 hours old. Nothing to run by hand.

Hash re-checks scheduled by the previous code (`recheckHashes` with an `attempt` and no `pooled`)
also still run: while the photo has no re-check armed on the pool, such a re-check checks the
hashes and hands the next attempt to the pool; once the pool owns the photo, it does nothing. A
waiting photo whose old chain was lost is re-armed by the first daily sweep. Nothing to run by
hand.

## Monitoring

Each attempt still logs `library.moderatePhoto`, `solving.moderateCompletionPhoto`,
`catalog.moderateBoxArt`, `conversation.moderateMessageImage` or `sharing.moderateCircleIcon`, now
with `decision: "retry"` and
`retry_reason` when the pool will try again. Two new events, both at error level when they change a
row:

- `imageModeration.checkFailed`: a check ended without a result (`result_kind`, `error`,
  `unscored_reason`, `stamped`).
- `imageModeration.stalledSweep`: one per sweep page (`table`, `scanned`, `stamped`,
  `stamped_image_ids`).
- `imageModeration.hashRecheckFailed`: the pool gave up on a hash re-check (`attempt`,
  `result_kind`, `error`, `rearmed`, `next_recheck_in_ms`).
- `imageModeration.hashRecheckSweep`: one per sweep page (`table`, `scanned`, `waiting`,
  `rearmed`, `rearmed_image_ids`).
- `imageModeration.hashCheckTimedOut`: a photo's re-checks stopped after
  `HASH_CHECK_TIMEOUT_MS` and it needs an admin (`table`, `image_id`, `attempt`, `waited_ms`).
  Always error level: each one is a photo waiting in **Unchecked photos**.

Each hash re-check logs `<table event>.hashRecheck` (for example `library.moderatePhoto.hashRecheck`)
with `attempt`, `pooled` and `csam_hashcheck_status`, or `result: "skipped_stale"` for a job that
was superseded. On a match it carries the escalation id only.

A steady trickle of either means checks are being lost and is worth a look. The pool itself logs a
periodic `{"component":"workpool","event":"report"}` line with its backlog and failure rate; the
`@convex-dev/workpool` README has ready-made Axiom queries for it.

```
['jigswap'] | where event in ("imageModeration.checkFailed","imageModeration.stalledSweep","imageModeration.hashRecheckFailed","imageModeration.hashRecheckSweep","imageModeration.hashCheckTimedOut") and outcome == "error" | summarize count() by event, bin(_time, 1d)
```
