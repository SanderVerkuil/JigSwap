import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The member's presence settings row (presencePreferences); null = never set: not sharing,
// override "auto".
export const presenceOverrideValidator = v.union(
  v.literal("auto"),
  v.literal("away"),
  v.literal("invisible"),
);

export const findPresencePreferences = (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<Doc<"presencePreferences"> | null> =>
  ctx.db
    .query("presencePreferences")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
