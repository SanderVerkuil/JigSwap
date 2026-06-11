import { Id } from "../../shared-kernel";

// The Notification aggregate's own identity.
export type NotificationId = Id<"NotificationId">;

// The NotificationPreference aggregate's own identity. Preferences are also keyed by member
// (one preference set per member), but we keep an explicit id so the persistence shape mirrors
// a row with its own primary key, matching the other aggregates in this package.
export type NotificationPreferenceId = Id<"NotificationPreferenceId">;

// Foreign-aggregate reference held as a branded string. Notifications is a downstream, generic
// subscriber: it never loads the Member aggregate (owned by Identity & Access); it only carries
// the id. Declared LOCALLY so this context stays decoupled from other contexts' types. (The
// flat barrel re-exports Exchange's structurally identical MemberId canonically; both are the
// same brand, so they interchange at the boundary.)
export type MemberId = Id<"MemberId">;
