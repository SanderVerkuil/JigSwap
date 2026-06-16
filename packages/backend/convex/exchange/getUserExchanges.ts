import type { ExchangeSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { enrichExchangeSummary } from "./readViews";

type Roled = Doc<"exchanges"> & { userRole: "requester" | "owner" };

// Exchange read (thin adapter): a member's exchanges as requester and/or owner. Role tagging,
// optional status filter, newest-first ordering and the two-step puzzle joins all match the legacy
// exchanges.getUserExchanges; only the per-row shape is now a typed ExchangeSummaryView.
export const getUserExchanges = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    asRequester: v.optional(v.boolean()),
    asOwner: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ExchangeSummaryView[]> => {
    // Scope to the authenticated member; never trust a client-supplied id (would leak any user's
    // exchange history + partner emails). Mirror getExchangesByOwner: [] when unauthenticated.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    let exchanges: Roled[] = [];

    if (args.asRequester !== false) {
      const requesterExchanges = await ctx.db
        .query("exchanges")
        .withIndex("by_initiator", (q) => q.eq("initiatorId", user._id))
        .collect();
      exchanges.push(
        ...requesterExchanges.map((tr) => ({
          ...tr,
          userRole: "requester" as const,
        })),
      );
    }

    if (args.asOwner !== false) {
      const ownerExchanges = await ctx.db
        .query("exchanges")
        .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
        .collect();
      exchanges.push(
        ...ownerExchanges.map((tr) => ({ ...tr, userRole: "owner" as const })),
      );
    }

    if (args.status) {
      exchanges = exchanges.filter((tr) => tr.status === args.status);
    }

    exchanges.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      exchanges.map((tr) => enrichExchangeSummary(ctx, tr, tr.userRole)),
    );
  },
});
