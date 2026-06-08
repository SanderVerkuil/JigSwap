import { makeAcceptExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// Recipient accepts a proposed exchange. Party-auth + legal transition enforced by the aggregate.
export const accept = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) => runAction(ctx, args.exchangeId, makeAcceptExchange),
});
