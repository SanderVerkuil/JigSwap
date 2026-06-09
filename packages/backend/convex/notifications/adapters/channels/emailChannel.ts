import type { Notification } from "@jigswap/domain";

// STUB email channel (Phase 5+ wires real SMTP/provider delivery). It is intentionally a no-op so
// that opting a member into email does NOT silently create in-app rows — only inAppChannel persists.
export const emailChannel = async (_notification: Notification): Promise<void> => {
  // No real send yet; left dormant until the email provider is integrated.
};
