import { toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexConnectionPolicy } from "./adapters/connectionPolicy";

// Read-model wrapper over the ConnectionPolicy so the UI can gate its "Message" affordances with
// the SAME rules openDmThread enforces (mutual follow, shared circle, existing pair thread).
// Self is false — a member never messages themself.
export const canMessage = query({
  args: { recipientId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const me = await requireMember(ctx);
    if ((me as string) === args.recipientId) return false;
    return convexConnectionPolicy(ctx).canMessage(
      me,
      toMemberId(args.recipientId),
    );
  },
});
