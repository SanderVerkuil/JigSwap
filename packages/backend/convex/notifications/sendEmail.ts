import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { makeEmailSenderFromEnv } from "./adapters/email";

// Out-of-band email delivery for ONE notification, scheduled (runAfter 0) by the email channel after
// the originating mutation commits. Today the configured sender is a no-op (Knock removed, no
// provider chosen yet), so this logs and drops; wiring a real provider is a swap inside
// makeEmailSenderFromEnv with no change here. Not a "use node" action — a real provider would use
// `fetch`, which the default Convex runtime supports.
export const send = internalAction({
  args: {
    to: v.string(),
    toName: v.string(),
    subject: v.string(),
    body: v.string(),
    type: v.string(),
    relatedId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await makeEmailSenderFromEnv().send(args);
  },
});
