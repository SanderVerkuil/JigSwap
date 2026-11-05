import { makeConfirmCompletion } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyPort } from "./adapters/convexCopyPort";
import { runAction } from "./runAction";

// A party confirms completion. Settlement (and ownership transfer) happens only once BOTH
// parties have confirmed — the dual-confirmation invariant lives in the aggregate. Every
// confirmation is refused while a copy the deal names is no longer where the deal found it (the
// domain's settlement guard), so a stale exchange never moves a copy out of a non-party's library.
export const confirmCompletion = mutation({
  args: { exchangeId: v.string() },
  handler: (ctx, args) =>
    runAction(ctx, args.exchangeId, (deps) =>
      makeConfirmCompletion({ ...deps, copies: convexCopyPort(ctx) }),
    ),
});
