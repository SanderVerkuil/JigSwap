import { makeRaiseDispute } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// Either party flags a problem with an accepted or completed exchange.
export const raiseDispute = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) => runAction(ctx, args.exchangeId, makeRaiseDispute),
});
