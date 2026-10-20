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

export default crons;
