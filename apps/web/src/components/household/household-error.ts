import { ConvexError } from "convex/values";

// The household mutations reject with `ConvexError<{ code, message }>`; these are the codes the UI
// explains to the member (everything else gets a generic message).
const KNOWN_CODES = new Set([
  "AlreadyInHousehold",
  "NotInHousehold",
  "InviteeAlreadyInHousehold",
  "DuplicateInvite",
  "InviteNotFound",
  "HouseholdNotFound",
  "NotHouseholdAdmin",
  "InviteNotPending",
  "MemberNotFound",
  "NotCopyOwner",
  "PermissionBatchTooLarge",
  "CopyNotFound",
]);

// The `household` namespace i18n key describing why a household mutation failed.
export function householdErrorKey(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (data && typeof data.code === "string" && KNOWN_CODES.has(data.code)) {
      return `errors.${data.code}`;
    }
  }
  return "errors.generic";
}
