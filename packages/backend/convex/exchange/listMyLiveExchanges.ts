import {
  LIVE_EXCHANGES_PER_READ,
  type ExchangeSummaryView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { clampOffset } from "../lib/pageSize";
import { enrichExchangeSummary, readLiveExchanges } from "./readViews";

// Exchange read: what is still in play for the signed-in member (proposed, accepted, disputed), in
// both roles, most recent activity first, each with its role. It reads only the live ranges (at most
// EXCHANGE_LIST_CAP per role and status), so a finished exchange never costs anything here and an
// old open one is never cut off by newer finished ones. Finished exchanges page separately
// (listMyExchangeHistory). [] when unauthenticated, unknown or deactivated.
//
// One read joins LIVE_EXCHANGES_PER_READ rows at most, the `page`-th window of them (default the
// first, which the dashboard's counts and headline share). A member can be sent hundreds of proposals
// by others, and a read that joined them all would throw: the Exchanges page asks for the next window
// when it holds a full one, because any of them can need the member's answer.
export const listMyLiveExchanges = query({
  args: { page: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ExchangeSummaryView[]> => {
    const me = await optionalActingMember(ctx);
    if (!me) return [];
    const [asRequester, asOwner] = await Promise.all([
      readLiveExchanges(ctx, me, "initiator"),
      readLiveExchanges(ctx, me, "recipient"),
    ]);
    const rows = [
      ...asRequester.map((row) => ({ row, role: "requester" as const })),
      ...asOwner.map((row) => ({ row, role: "owner" as const })),
    ].sort((a, b) => b.row.updatedAt - a.row.updatedAt);
    const from = clampOffset(args.page) * LIVE_EXCHANGES_PER_READ;
    return Promise.all(
      rows
        .slice(from, from + LIVE_EXCHANGES_PER_READ)
        .map(({ row, role }) => enrichExchangeSummary(ctx, row, me, role)),
    );
  },
});
