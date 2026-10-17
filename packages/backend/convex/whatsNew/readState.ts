import { unreadWhatsNewEntryIds } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { whatsNewManifest } from "./manifest";

// The acting member's user row (createdAt is the What's new read cutoff).
export const requireMemberUser = async (
  ctx: QueryCtx,
): Promise<Doc<"users">> => {
  const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
  const user = await ctx.db.get(memberId);
  if (!user) throw new ConvexError("Member not found");
  return user;
};

export const readStateOf = (ctx: QueryCtx, memberId: Id<"users">) =>
  ctx.db
    .query("whatsNewReadStates")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();

// Add `ids` to the member's seen set. Only manifest entries published after the account was
// created are stored (anything else is unknown or read by definition), in manifest order, and ids
// that left the manifest drop out, so the row stays small and repeated calls are no-ops.
export const markSeen = async (
  ctx: MutationCtx,
  member: Doc<"users">,
  ids: Iterable<string>,
): Promise<void> => {
  const row = await readStateOf(ctx, member._id);
  const wanted = new Set([...(row?.seenEntryIds ?? []), ...ids]);
  const next = unreadWhatsNewEntryIds(whatsNewManifest(), {
    memberCreatedAt: member.createdAt,
    seenIds: [],
  }).filter((id) => wanted.has(id));

  if (row) {
    const unchanged =
      next.length === row.seenEntryIds.length &&
      next.every((id, i) => id === row.seenEntryIds[i]);
    if (!unchanged) {
      await ctx.db.patch(row._id, {
        seenEntryIds: next,
        updatedAt: Date.now(),
      });
    }
  } else if (next.length > 0) {
    await ctx.db.insert("whatsNewReadStates", {
      memberId: member._id,
      seenEntryIds: next,
      updatedAt: Date.now(),
    });
  }
};
