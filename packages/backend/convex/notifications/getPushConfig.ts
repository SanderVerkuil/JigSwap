import { query } from "../_generated/server";

// Client-facing push config. The VAPID PUBLIC key is non-secret (it's the applicationServerKey the
// browser subscribes with), so serving it from the deployment env keeps a single source of truth
// (no separate client build-time env). `null` means push is not configured on this deployment, so
// the client hides/disables the push controls.
export const getPushConfig = query({
  args: {},
  handler: async () => ({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  }),
});
