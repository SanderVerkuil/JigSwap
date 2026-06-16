import type {
  CopyCustodyTimelineView,
  CustodyTransferView,
  ProjectedMember,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { projectMemberIdentity } from "../social/privacy";

// Chain-of-Custody read: a Copy's full provenance assembled from the custody projection. Ownership
// IS reassigned on a swap/sale, so the copy's stored ownerId is the CURRENT holder; the chain is
// derived from the projected entries — the original owner is the first transfer's previousOwner and
// the current owner is the last transfer's recipient (falling back to the copy's owner when it was
// never transferred). Auth-gated; every surfaced member is run through `projectMemberIdentity`
// (salt = copyId) so a hidden member's real identity never enters the returned DTO — mirroring
// getCopyInstanceView's privacy contract.
export const getCopyCustodyTimeline = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CopyCustodyTimelineView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) return null;

    const entries = await ctx.db
      .query("copyCustodyEntries")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .order("asc")
      .collect();

    const salt = args.copyId as string;
    // Memoise the projection per target so a hidden member yields one stable anonRef across every
    // surfaced reference (same target + same salt -> same token).
    const projections = new Map<string, Promise<ProjectedMember>>();
    const project = (targetId: string): Promise<ProjectedMember> => {
      const existing = projections.get(targetId);
      if (existing) return existing;
      const p = projectMemberIdentity(
        ctx,
        viewerId,
        targetId as Id<"users">,
        salt,
      );
      projections.set(targetId, p);
      return p;
    };

    const transfers: CustodyTransferView[] = await Promise.all(
      entries.map(async (e) => ({
        exchangeId: e.exchangeId,
        newOwner: await project(e.newOwner),
        occurredAt: e.occurredAt,
      })),
    );

    const first = entries.at(0);
    const last = entries.at(-1);
    const originalOwner = await project(
      first ? first.previousOwner : copy.ownerId,
    );
    const currentOwner = await project(last ? last.newOwner : copy.ownerId);

    return {
      copyId: args.copyId,
      originalOwner,
      transfers,
      currentOwner,
    };
  },
});
