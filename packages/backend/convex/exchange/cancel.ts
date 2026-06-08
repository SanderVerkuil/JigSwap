import { makeCancelExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// Initiator cancels a proposed or accepted exchange.
export const cancel = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) => runAction(ctx, args.exchangeId, makeCancelExchange),
});
