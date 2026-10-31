import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type ModerationKind =
  | "definition_approved"
  | "definition_rejected"
  | "definition_edited_approved"
  | "definition_disabled"
  | "definition_reenabled"
  | "definition_edited"
  | "proposal_approved"
  | "proposal_rejected"
  | "photo_restored"
  | "photo_removal_confirmed"
  | "photo_auto_rejected"
  | "photo_manually_approved"
  | "photo_manually_rejected"
  | "photo_hash_check_waived"
  | "image_quarantined"
  | "csam_escalation_updated"
  | "role_granted"
  | "role_revoked"
  | "report_dismissed"
  | "report_content_removed"
  | "report_warned"
  | "message_image_auto_rejected"
  | "message_image_restored"
  | "photo_recheck_requested"
  | "category_created"
  | "category_updated"
  | "category_deactivated"
  | "category_reactivated"
  | "categories_reordered"
  | "contact_message_handled"
  | "contact_message_reopened";

/**
 * The stored targetLabel of a row that targets a member (SEC-57): neutral, never their name or
 * email. The admin read models resolve the label from targetMemberId (admin/auditEntry).
 */
export const MEMBER_TARGET_LABEL = "Member";

/** The kinds stamped about a member, rather than about content. */
export const MEMBER_TARGET_KINDS: ReadonlySet<ModerationKind> = new Set([
  "role_granted",
  "role_revoked",
  "report_dismissed",
  "report_content_removed",
  "report_warned",
]);

// One-liner used by every moderation decision point so the audit trail can't drift. A row about
// content carries its display title as targetLabel; a row about a member carries targetMemberId
// instead and gets the neutral MEMBER_TARGET_LABEL, so no member's name or email is ever stored
// (it would outlive their account).
export const stampModerationAction = (
  ctx: MutationCtx,
  a: {
    actorId?: Id<"users">;
    kind: ModerationKind;
    targetId: string;
  } & (
    | { targetLabel: string; targetMemberId?: never }
    | { targetMemberId: Id<"users">; targetLabel?: never }
  ),
) =>
  ctx.db.insert("moderationActions", {
    ...a,
    targetLabel: a.targetLabel ?? MEMBER_TARGET_LABEL,
    at: Date.now(),
  });
