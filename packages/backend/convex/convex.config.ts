import presence from "@convex-dev/presence/convex.config.js";
import { defineApp } from "convex/server";

// The repo's first Convex component. Presence powers ONE thing today: suppressing
// message_received notifications for members who are already on the messages page
// (see notifications/presenceGate.ts and the design spec).
const app = defineApp();
app.use(presence);

export default app;
