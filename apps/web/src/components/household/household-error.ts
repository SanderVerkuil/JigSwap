import { convexErrorCode } from "@/lib/convex-error-code";

// The household mutations reject with `ConvexError<{ code, message }>`; these are the codes the UI
// explains to the member (everything else gets a generic message).
const KNOWN_CODES = new Set([
  "AlreadyInHousehold",
  "NotInHousehold",
  "DuplicateInvite",
  "InviteNotFound",
  "HouseholdNotFound",
  "NotHouseholdAdmin",
  "InviteNotPending",
  "MemberNotFound",
  "NotCopyOwner",
  "PermissionBatchTooLarge",
  "CopyNotFound",
  "AlreadyMember",
  "InvalidHouseholdName",
  "JoinRequestOpen",
  "JoinRequestAlreadySent",
  "JoinRequestNotFound",
  "JoinRequestNotPending",
  "RateLimited",
  "InviteLinkLive",
]);

// The `household` namespace i18n key describing why a household mutation failed.
export function householdErrorKey(error: unknown): string {
  const code = convexErrorCode(error);
  return code && KNOWN_CODES.has(code) ? `errors.${code}` : "errors.generic";
}
