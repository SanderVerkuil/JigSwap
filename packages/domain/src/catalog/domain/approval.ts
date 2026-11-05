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

// The statuses in which a definition HOLDS its barcodes: while one exists, no other definition
// may carry the same EAN/UPC/model number. A rejected definition releases them, because
// rejection is terminal (the row can never be listed again) and a held barcode would let junk
// submissions squat real products. Pending holds until an admin decides; disabled was moderated
// once and may be re-enabled, so it keeps its barcodes.
export const BARCODE_HOLDING_STATUSES: readonly ApprovalStatus[] = [
  "pending",
  "approved",
  "disabled",
];
