import presence from "@convex-dev/presence/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";

// The repo's Convex components.
// - Presence powers ONE thing today: suppressing message_received notifications for members who
//   are already on the messages page (see notifications/presenceGate.ts and the design spec).
// - moderationWorkpool runs every photo-moderation check (lib/imageModeration/moderationPool.ts):
//   bounded parallelism toward the classifier, retries with backoff, and a completion callback
//   that also fires when an attempt crashed (timeout, restart, deploy).
// - hashRecheckWorkpool runs the CSAM hash re-checks of photos whose hash check was unavailable
//   (lib/imageModeration/hashRecheckPool.ts): its own pool, so the hash service's limits and a
//   re-check backlog never take slots from the classifier checks, and the other way round.
const app = defineApp();
app.use(presence);
app.use(workpool, { name: "moderationWorkpool" });
app.use(workpool, { name: "hashRecheckWorkpool" });

export default app;
