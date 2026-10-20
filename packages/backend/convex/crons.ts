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

export default crons;
