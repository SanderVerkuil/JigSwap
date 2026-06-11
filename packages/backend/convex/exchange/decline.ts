import { makeDeclineExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// Recipient declines a proposed exchange.
export const decline = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) => runAction(ctx, args.exchangeId, makeDeclineExchange),
});
