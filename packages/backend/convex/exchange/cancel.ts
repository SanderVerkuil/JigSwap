import { makeCancelExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { runAction } from "./runAction";

// Call an exchange off: the initiator a proposed or accepted one, the recipient an accepted one
// (Exchange.cancel). The other party is notified.
export const cancel = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) => runAction(ctx, args.exchangeId, makeCancelExchange),
});
