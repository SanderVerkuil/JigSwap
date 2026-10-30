import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Photos whose moderation check never finished: stamped "unscored" ("stalled") after 24 hours, so
// they reach the admin's Unchecked photos queue (lib/imageModeration/stalledSweep).
crons.daily(
  "stamp stalled photo checks",
  { hourUTC: 3, minuteUTC: 30 },
  internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
  {},
);

// Photos held for their CSAM hash check whose re-check was lost (none armed, or overdue by a day):
// re-armed on the hash re-check Workpool (lib/imageModeration/hashRecheckPool).
crons.daily(
  "re-arm lost hash re-checks",
  { hourUTC: 3, minuteUTC: 45 },
  internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
  {},
);

// The moderation backlog (pending photos per table, the oldest wait, photos waiting on a hash
// re-check) next to both pools' parallelism: one wide event to the log and Axiom
// (lib/imageModeration/queueDepth), so the owner can tell whether the pools keep up.
crons.interval(
  "log moderation queue depth",
  { minutes: 15 },
  internal.lib.imageModeration.queueDepth.logModerationQueueDepth,
  {},
);

// Blobs nothing holds (older than a day) and box art only its listing holds (older than a week):
// a DRY RUN that only logs `storage.sweep`, unless the deployment env STORAGE_GC_MODE is "delete"
// (lib/storage/storageSweep; preconditions in docs/deployment/photo-moderation.md).
crons.daily(
  "sweep unheld storage blobs",
  { hourUTC: 4, minuteUTC: 15 },
  internal.lib.storage.storageSweep.sweepStorage,
  {},
);

// The users.role mirror (admin-only notification targeting) reconciled with Clerk, in case a user
// webhook was lost (backfillUserRoles). Skipped where CLERK_SECRET_KEY is unset (previews).
crons.daily(
  "reconcile role mirror",
  { hourUTC: 4, minuteUTC: 15 },
  internal.backfillUserRoles.run,
  {},
);

// Retention backstops (lib/retention): dry-run unless RETENTION_ENFORCE names the sweep.
// Reports past their 12 months and evidence copies past their 6 months whose purge job was lost
// get it re-armed; reports left open over 30 days are logged at error level
// (reports/retention).
crons.daily(
  "report retention backstop",
  { hourUTC: 4, minuteUTC: 0 },
  internal.reports.retention.sweepReportRetention,
  {},
);

// Photos still being checked a week after they were sent are deleted (their messages read "Photo
// no longer available"); held by an open report or an unfinished hash check, they are kept
// (conversation/attachmentModerationStore).
crons.daily(
  "sent photo retention",
  { hourUTC: 4, minuteUTC: 15 },
  internal.conversation.attachmentModerationStore.sweepUncheckedSentPhotos,
  {},
);

// Copy photos the automated check rejected are deleted 30 days after the rejection, unless an
// open report is about one or its hash check has not finished (library/moderationStore).
crons.daily(
  "rejected copy photo retention",
  { hourUTC: 4, minuteUTC: 30 },
  internal.library.moderationStore.sweepRejectedCopyPhotos,
  {},
);

// Domain events dispatched more than the activity feed's 90 days plus a week ago are deleted with
// their member lookup rows (dry run unless RETENTION_ENFORCE names "domainEvents"); events in
// flight or failed are kept (events/retention).
crons.daily(
  "domain event retention",
  { hourUTC: 4, minuteUTC: 45 },
  internal.events.retention.sweepEventRetention,
  {},
);

// Old notifications (read after 180 days, any after 365): DRY RUN only, weekly, logging a capped
// sample of what would be deleted (notifications/retention). Switching to "delete" waits for the
// owner to approve the periods and add the retention line to the privacy policy, and only deletes
// once RETENTION_ENFORCE also names "notifications" (lib/retention).
crons.weekly(
  "count expired notifications (dry run)",
  { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 15 },
  internal.notifications.retention.sweepExpiredNotifications,
  { mode: "dry-run" },
);

// The public landing page's counters: users, puzzles and ownedPuzzles recounted into the
// platformStats row that insights/getGlobalStats reads (insights/platformStats).
crons.interval(
  "recount platform stats",
  { hours: 6 },
  internal.insights.platformStats.recount,
  {},
);

export default crons;
