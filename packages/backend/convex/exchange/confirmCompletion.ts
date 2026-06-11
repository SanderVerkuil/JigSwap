import { makeConfirmCompletion } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// A party confirms completion. Settlement (and ownership transfer) happens only once BOTH
// parties have confirmed — the dual-confirmation invariant lives in the aggregate.
export const confirmCompletion = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) =>
    runAction(ctx, args.exchangeId, makeConfirmCompletion),
});
