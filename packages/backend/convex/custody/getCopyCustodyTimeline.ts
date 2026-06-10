import type {
  CopyCustodyTimelineView,
  CustodyTransferView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Chain-of-Custody read: a Copy's full provenance assembled from the custody projection. The copy's
// stored ownerId is the ORIGINAL holder (settlement marks copies unavailable rather than reassigning
// this row's owner); each projected OwnershipTransferred row is a transfer in chronological order;
// the current owner is the last transfer's recipient, or the original owner when never transferred.
// Member views are resolved via the shared identity mapper; null when a user row no longer resolves.
export const getCopyCustodyTimeline = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CopyCustodyTimelineView | null> => {
    const copy = await ctx.db.get(args.copyId);
    if (!copy) return null;

    const entries = await ctx.db
      .query("copyCustodyEntries")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .order("asc")
      .collect();

    // Resolve every distinct member once (original owner + each transfer recipient).
    const memberIds = new Set<string>([copy.ownerId, ...entries.map((e) => e.newOwner)]);
    const members = new Map(
      await Promise.all(
        [...memberIds].map(async (id) => {
          const user = await ctx.db.get(id as Id<"users">);
          return [id, user ? toMemberView(user) : null] as const;
        }),
      ),
    );

    const transfers: CustodyTransferView[] = entries.map((e) => ({
      exchangeId: e.exchangeId,
      newOwner: members.get(e.newOwner) ?? null,
      occurredAt: e.occurredAt,
    }));

    const last = entries.at(-1);
    return {
      copyId: args.copyId,
      originalOwner: members.get(copy.ownerId) ?? null,
      transfers,
      currentOwner: last ? (members.get(last.newOwner) ?? null) : (members.get(copy.ownerId) ?? null),
    };
  },
});
