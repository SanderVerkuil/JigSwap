import type { Notification } from "@jigswap/domain";

// STUB push channel (Phase 5+ wires real web/native push delivery). Intentionally a no-op so an
// opt-in does not produce in-app rows — only inAppChannel persists.
export const pushChannel = async (
  _notification: Notification,
): Promise<void> => {
  // No real send yet; left dormant until push delivery is integrated.
};
