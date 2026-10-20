import presence from "@convex-dev/presence/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";

// The repo's Convex components.
// - Presence powers ONE thing today: suppressing message_received notifications for members who
//   are already on the messages page (see notifications/presenceGate.ts and the design spec).
// - moderationWorkpool runs every photo-moderation check (lib/imageModeration/moderationPool.ts):
//   bounded parallelism toward the classifier, retries with backoff, and a completion callback
//   that also fires when an attempt crashed (timeout, restart, deploy).
const app = defineApp();
app.use(presence);
app.use(workpool, { name: "moderationWorkpool" });

export default app;
