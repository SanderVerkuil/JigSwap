import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import {
  MEMBER_TARGET_KINDS,
  MEMBER_TARGET_LABEL,
} from "./stampModerationAction";

// One moderation audit row as the admin console shows it (the Activity Log, a member's and a
// definition's trail). Admin-only: callers gate on requireMember + isAdmin.

/** The label of a row whose member's account is gone; the web shows its localized label. */
export const DELETED_MEMBER_LABEL = "Deleted member";

export type AuditEntry = {
  kind: Doc<"moderationActions">["kind"];
  /** Acting admin's label; null = automated pipeline (no actorId) or a deleted admin. */
  actorName: string | null;
  targetLabel: string;
  targetId: string;
  at: number;
  /** The row targets a member whose account is gone. */
  targetMemberDeleted?: true;
};

const DELETED_TARGET = {
  targetLabel: DELETED_MEMBER_LABEL,
  targetMemberDeleted: true,
} as const;

// A row about a member stores only their id (SEC-57): the label is their live admin label while
// the account exists, "Deleted member" once it is gone. A legacy row the backfill could not link
// (the account was already gone) keeps only the neutral label. Any other row shows its stored
// title.
const targetOf = async (
  ctx: QueryCtx,
  row: Doc<"moderationActions">,
): Promise<Pick<AuditEntry, "targetLabel" | "targetMemberDeleted">> => {
  if (row.targetMemberId !== undefined) {
    const member = await ctx.db.get(row.targetMemberId);
    return member
      ? { targetLabel: adminMemberLabelOf(member) }
      : DELETED_TARGET;
  }
  if (
    MEMBER_TARGET_KINDS.has(row.kind) &&
    row.targetLabel === MEMBER_TARGET_LABEL
  ) {
    return DELETED_TARGET;
  }
  return { targetLabel: row.targetLabel };
};

export const toAuditEntry = async (
  ctx: QueryCtx,
  row: Doc<"moderationActions">,
): Promise<AuditEntry> => {
  const actor = row.actorId ? await ctx.db.get(row.actorId) : null;
  return {
    kind: row.kind,
    actorName: actor ? adminMemberLabelOf(actor) : null,
    ...(await targetOf(ctx, row)),
    targetId: row.targetId,
    at: row.at,
  };
};
