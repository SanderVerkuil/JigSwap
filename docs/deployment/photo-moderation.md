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

The CSAM hash re-check (`HASH_RECHECK_DELAYS_MS`, when the hash service was unavailable) is a
separate chain and still runs on the Convex scheduler.

## Rollout: checks in flight at deploy time

Retries scheduled by the previous code (`moderatePhoto` and friends with an `attempt` argument)
still run after the deploy: the actions keep accepting `attempt`, ignore it, and hand a retry to
the pool instead of scheduling one. A row whose old retry chain was lost before the deploy is
stamped `stalled` by the first daily sweep after it is 24 hours old. Nothing to run by hand.

## Monitoring

Each attempt still logs `library.moderatePhoto`, `solving.moderateCompletionPhoto`,
`catalog.moderateBoxArt` or `conversation.moderateMessageImage`, now with `decision: "retry"` and
`retry_reason` when the pool will try again. Two new events, both at error level when they change a
row:

- `imageModeration.checkFailed`: a check ended without a result (`result_kind`, `error`,
  `unscored_reason`, `stamped`).
- `imageModeration.stalledSweep`: one per sweep page (`table`, `scanned`, `stamped`,
  `stamped_image_ids`).

A steady trickle of either means checks are being lost and is worth a look. The pool itself logs a
periodic `{"component":"workpool","event":"report"}` line with its backlog and failure rate; the
`@convex-dev/workpool` README has ready-made Axiom queries for it.

```
['jigswap'] | where event in ("imageModeration.checkFailed","imageModeration.stalledSweep") and outcome == "error" | summarize count() by event, bin(_time, 1d)
```
