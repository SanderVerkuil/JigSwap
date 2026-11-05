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

// Blobs nothing holds (older than a day) and box art only its listing holds (older than a week):
// a DRY RUN that only logs `storage.sweep`, unless the deployment env STORAGE_GC_MODE is "delete"
// (lib/storage/storageSweep; preconditions in docs/deployment/photo-moderation.md).
crons.daily(
  "sweep unheld storage blobs",
  { hourUTC: 4, minuteUTC: 15 },
  internal.lib.storage.storageSweep.sweepStorage,
  {},
);

export default crons;
