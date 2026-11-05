import type { ExchangeSummaryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { enrichExchangeSummary, readLiveExchanges } from "./readViews";

// Exchange read: everything still in play for the signed-in member (proposed, accepted, disputed), in
// both roles, most recent activity first, each with its role. The Exchanges page lists these whole,
// because any of them can need the member's answer, and the dashboard's counts and headline read the
// same subscription. It reads only the live ranges (at most EXCHANGE_LIST_CAP per role and status),
// so a finished exchange never costs anything here and an old open one is never cut off by newer
// finished ones. Finished exchanges page separately (listMyExchangeHistory). [] when unauthenticated,
// unknown or deactivated.
export const listMyLiveExchanges = query({
  args: {},
  handler: async (ctx): Promise<ExchangeSummaryView[]> => {
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
    return Promise.all(
      rows.map(({ row, role }) => enrichExchangeSummary(ctx, row, me, role)),
    );
  },
});
