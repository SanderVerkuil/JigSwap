import type { CopyCircleShareView } from "@jigswap/contracts";
import { canExchangeWithin } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isCopySharedInto, ownCopyOf } from "./adapters/circleCopyShares";
import { circleByAggregateId } from "./circleAccess";
import { circleIconFields } from "./circleIcons";
import { toCircleSummary } from "./readViews";

// The "Share with circles" dialog of one of the viewer's own copies: every circle they belong to
// (by name), whether the copy is shared there, and whether their seat may share into it (Exchange
// or Admin). Owner only: someone else's copy and a missing one both answer null, so the read tells
// nobody where another member's copy is shared.
export const getCopyCircleShares = query({
  args: { copyId: v.string() },
  handler: async (ctx, args): Promise<CopyCircleShareView[] | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await ownCopyOf(ctx, viewerId, args.copyId))) return null;

    const links = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", viewerId))
      .collect();

    const views: CopyCircleShareView[] = [];
    for (const link of links) {
      const row = await circleByAggregateId(ctx, link.circleAggregateId);
      if (!row?.aggregateId) continue;
      const { memberCount, viewerPermission } = toCircleSummary(row, viewerId);
      const { iconUrl } = await circleIconFields(ctx, row, viewerId);
      views.push({
        circleId: row.aggregateId,
        name: row.name,
        memberCount,
        viewerPermission,
        ...(iconUrl ? { iconUrl } : {}),
        shared: await isCopySharedInto(ctx, row.aggregateId, args.copyId),
        canShare: canExchangeWithin(viewerPermission),
      });
    }
    return views.sort((a, b) => a.name.localeCompare(b.name));
  },
});
