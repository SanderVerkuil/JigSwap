import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type ModerationKind =
  | "definition_approved"
  | "definition_rejected"
  | "definition_edited_approved"
  | "photo_restored"
  | "photo_removal_confirmed"
  | "photo_auto_rejected";

// One-liner used by every moderation decision point so the audit trail can't drift.
export const stampModerationAction = (
  ctx: MutationCtx,
  a: {
    actorId?: Id<"users">;
    kind: ModerationKind;
    targetLabel: string;
    targetId: string;
  },
) => ctx.db.insert("moderationActions", { ...a, at: Date.now() });
