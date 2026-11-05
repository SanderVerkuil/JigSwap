import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { clampPaginationOpts } from "../lib/pageSize";
import schema from "../schema";
import { enrichExchangeSummary, isLiveExchangeStatus } from "./readViews";

// A page holds 1 to MAX_PAGE_SIZE exchanges whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Exchange read: the signed-in member's finished exchanges (completed, rejected, cancelled), most
// recent activity first, a page at a time. What's still in play is listMyLiveExchanges. `direction`
// and `status` narrow while the page fills, so pages stay full; each row joins both parties and both
// copies only once it is on a page. An empty, finished page when unauthenticated, unknown or
// deactivated. Scoped to the caller: there is no member argument.
export const listMyExchangeHistory = query({
  args: {
    paginationOpts: paginationOptsValidator,
    direction: v.optional(
      v.union(v.literal("all"), v.literal("incoming"), v.literal("outgoing")),
    ),
    status: v.optional(
      v.union(
        v.literal("completed"),
        v.literal("rejected"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const me = await optionalActingMember(ctx);
    if (!me) return { page: [], isDone: true, continueCursor: "" };

    const direction = args.direction ?? "all";
    const streams = [
      ...(direction !== "incoming"
        ? [
            stream(ctx.db, schema)
              .query("exchanges")
              .withIndex("by_initiator_updated", (q) => q.eq("initiatorId", me))
              .order("desc"),
          ]
        : []),
      ...(direction !== "outgoing"
        ? [
            stream(ctx.db, schema)
              .query("exchanges")
              .withIndex("by_recipient_updated", (q) => q.eq("recipientId", me))
              .order("desc"),
          ]
        : []),
    ];
    const result = await mergedStream(streams, ["updatedAt"])
      .filterWith(
        async (row) =>
          !isLiveExchangeStatus(row.status) &&
          (args.status === undefined || row.status === args.status),
      )
      .paginate(clampPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE));

    const page = await Promise.all(
      result.page.map((row) =>
        enrichExchangeSummary(
          ctx,
          row,
          me,
          row.initiatorId === me ? "requester" : "owner",
        ),
      ),
    );
    return { ...result, page };
  },
});
