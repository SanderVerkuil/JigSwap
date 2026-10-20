# Photo moderation: retries, crashed checks and stalled photos (runbook)

Every uploaded photo (copy photos, completion photos, box art and message photos) is checked by
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
  `lib/imageModeration/stalledSweep.sweepStalledModeration` over all four tables. A photo still
  `pending` 24 hours after it was last touched (`updatedAt`; box art: `recheckedAt`, else
  `createdAt`) is stamped `unscored` with reason `stalled`. It reads only rows created before the
  cutoff, through the `by_moderation_status` index, one page of 100 per run, and stamps through
  each table's own verdict mutation, so re-running it changes nothing.

An `unscored` copy photo, completion photo or box art appears in **Admin → Moderation → Unchecked
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
  **Unchecked photos** as "Hash check timed out" (all four tables: copy photos, completion
  photos, box art and sent message photos). The last re-check runs a little over 7 days in. This
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
- **Backstop:** a daily cron (03:45 UTC) runs `hashRecheckPool.sweepLostHashRechecks` over all four
  tables (the `by_hash_check_pending` index, 100 rows per run). It re-arms, to run at once, a
  waiting photo that has no re-check armed, or whose current one was due more than 24 hours ago.
  A timed-out photo is not waiting any more and is left alone.

### A timed-out photo: the admin decides

The admin sees the photo (behind the usual blur-until-reveal guard, admins only, as for any
unchecked photo) and decides it with `admin/decideUncheckedPhoto`, whatever the classifier said:

- **Approve without hash check** (decision `waive_hash_check`; a button of its own that takes a
  second click to confirm) publishes it **without a hash check**: `hashCheckedAt` is set (the gate
  opens), `hashCheckWaivedBy` records the admin, and the audit trail stamps
  `photo_hash_check_waived` ("approved a photo without a hash check"), not the usual manual
  approval. A message photo the classifier blurred stays blurred. The normal **Approve** is not
  offered for a timed-out photo, and the server refuses it (`approve` on a timed-out row, and
  `waive_hash_check` on any row that did not time out, both throw), so a hash check is never
  skipped by the ordinary approval.
- **Reject** is the table's usual manual rejection (a copy photo moves to Flagged Images, a
  completion photo and box art are detached and deleted, a message photo is removed by moderation
  and its sender told). A rejected timed-out copy photo shows its image in **Flagged Images** to
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
- Nothing re-checks a timed-out photo on purpose: once the hash service is back, photos approved
  without a hash check are **not** re-checked automatically. They carry `hashCheckWaivedBy` and
  their `pendingHashes`, so they can be found and checked by hand if needed.

What admins see: a photo waiting on its hash check is counted on **Admin → Moderation → Hash
matches** ("Hash check unreachable: N photos waiting, unpublished", with the oldest wait). While it
waits it is not in **Unchecked photos** when the classifier approved it: there is nothing for an
admin to decide yet, and nobody can publish it before the hash check passes. A waiting photo that
the classifier could not score does appear there, without a preview, and cannot be approved or
rejected until its hash check has passed or timed out. A timed-out photo is listed there once, as
"Hash check timed out" with its image (read through the `by_hash_check_timed_out` index, with the
already-decided ones filtered out before the queue limit, so rejected timed-out rows never crowd
out undecided ones, and timed-out rows never take the place of ordinary unscored ones), counted
in the tab badge, and counted apart on **Hash
matches** ("Hash check timed out: N photos ... need an admin decision"). No notification is sent:
the admin notifications are built on member-facing domain events, so the tab count plus the
`imageModeration.hashCheckTimedOut` error event (below) are the alert. The 24-hour stalled sweep
only looks at photos whose classifier check is still `pending`, so it leaves a photo that is only
waiting on its hash check alone.

The hash check is not configured on dev or prod today (`CSAM_HASHCHECK_PROVIDER` unset means
"none", which answers no_match at once), so no photo waits and none of this runs until it is.

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
`catalog.moderateBoxArt` or `conversation.moderateMessageImage`, now with `decision: "retry"` and
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
