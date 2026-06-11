// A delivery channel for a notification (proposal §1.4). `inApp` is the always-on default; email
// and push are opt-in per type via NotificationPreference.
export type Channel = "inApp" | "email" | "push";

// All channels, for iterating preferences and fan-out. Order is delivery-priority-agnostic.
export const CHANNELS: readonly Channel[] = ["inApp", "email", "push"];
