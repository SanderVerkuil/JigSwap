// Moderation lifecycle of a PuzzleDefinition. Only `approved` definitions are publicly
// listable (an application-layer query concern); the aggregate owns the transitions.
export type ApprovalStatus = "pending" | "approved" | "rejected" | "disabled";

// Legal approval moves. A submission starts `pending`; moderation decides it once. An
// approved definition may be reversibly disabled (hidden from public surfaces) and
// re-enabled; `rejected` stays terminal (re-submission would be a new definition).
export const ALLOWED_APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalStatus, readonly ApprovalStatus[]>
> = {
  pending: ["approved", "rejected"],
  approved: ["disabled"],
  disabled: ["approved"],
  rejected: [],
};
