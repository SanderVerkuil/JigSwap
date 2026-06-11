import type {
  CopyCustodyTimelineView,
  CustodyTransferView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Chain-of-Custody read: a Copy's full provenance assembled from the custody projection. Ownership
// IS reassigned on a swap/sale, so the copy's stored ownerId is the CURRENT holder; the chain is
// derived from the projected entries — the original owner is the first transfer's previousOwner and
// the current owner is the last transfer's recipient (falling back to the copy's owner when it was
// never transferred). Member views are resolved via the shared identity mapper; null when unresolved.
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

    // Resolve every distinct member once (current owner + each transfer's from/to).
    const memberIds = new Set<string>([
      copy.ownerId,
      ...entries.flatMap((e) => [e.previousOwner, e.newOwner]),
    ]);
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

    const first = entries.at(0);
    const last = entries.at(-1);
    return {
      copyId: args.copyId,
      originalOwner:
        (first
          ? members.get(first.previousOwner)
          : members.get(copy.ownerId)) ?? null,
      transfers,
      currentOwner:
        (last ? members.get(last.newOwner) : members.get(copy.ownerId)) ?? null,
    };
  },
});
