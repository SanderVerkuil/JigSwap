import type { ExchangeSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import {
  boundedExchangeWindow,
  enrichExchangeSummary,
  readMemberExchanges,
} from "./readViews";

type Roled = Doc<"exchanges"> & { userRole: "requester" | "owner" };

// Exchange read (thin adapter): a member's exchanges as requester and/or owner. Role tagging,
// optional status filter, newest-first ordering and the two-step puzzle joins all match the legacy
// exchanges.getUserExchanges; only the per-row shape is now a typed ExchangeSummaryView.
// Kept for web builds from before the Exchanges page moved to listMyLiveExchanges and
// listMyExchangeHistory: this build no longer calls it. Remove once those have aged out.
export const getUserExchanges = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("accepted"),
        v.literal("rejected"),
        v.literal("completed"),
        v.literal("cancelled"),
        v.literal("disputed"),
      ),
    ),
    asRequester: v.optional(v.boolean()),
    asOwner: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ExchangeSummaryView[]> => {
    // Scope to the authenticated member; never trust a client-supplied id (would leak any user's
    // exchange history + partner emails). Mirror getExchangesByOwner: [] when unauthenticated,
    // unknown or deactivated.
    const me = await optionalActingMember(ctx);
    if (!me) return [];

    const rows: Roled[] = [];

    if (args.asRequester !== false) {
      const asRequester = await readMemberExchanges(
        ctx,
        me,
        "initiator",
        args.status,
      );
      rows.push(
        ...asRequester.map((tr) => ({ ...tr, userRole: "requester" as const })),
      );
    }

    if (args.asOwner !== false) {
      const asOwner = await readMemberExchanges(
        ctx,
        me,
        "recipient",
        args.status,
      );
      rows.push(
        ...asOwner.map((tr) => ({ ...tr, userRole: "owner" as const })),
      );
    }

    // Across both roles: newest first, the newest EXCHANGE_LIST_CAP plus the newest
    // EXCHANGE_LIST_CAP live ones (a status filter was already applied by the index read).
    const exchanges = boundedExchangeWindow(rows);

    return Promise.all(
      exchanges.map((tr) => enrichExchangeSummary(ctx, tr, me, tr.userRole)),
    );
  },
});
