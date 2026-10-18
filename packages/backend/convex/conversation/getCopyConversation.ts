import type { CopyConversationView } from "@jigswap/contracts";
import { toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { projectMemberIdentity } from "../social/privacy";
import { convexConnectionPolicy } from "./adapters/connectionPolicy";
import { participantsKeyOf } from "./adapters/threadMapper";
import { messageCopyViewOf } from "./copyCard";

// Where a copy's "Message" action lands. The counterpart is ALWAYS the copy's owner, derived
// here from the copy (for a household copy that is the actual owner, not a housemate); the client
// passes only the copy id. Read-only: it never creates a thread (startCopyConversation does, on
// first send). See CopyConversationView for the statuses. An owner anonymous to the viewer gets the
// constant `ownerHidden` BEFORE the DM lookup: the DM is one per pair, so surfacing it (or any
// owner-derived field) from a copy would let a viewer tie several copies to one hidden owner.
export const getCopyConversation = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CopyConversationView> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy || !(await canViewCopy(ctx, me, copy))) {
      return { status: "unavailable" };
    }
    const ownerId = copy.ownerId;
    if (ownerId === me) return { status: "self" };

    const owner = await projectMemberIdentity(ctx, me, ownerId, copy._id);
    if (owner.anonymous) return { status: "ownerHidden" };

    const dm = await ctx.db
      .query("threads")
      .withIndex("by_subject_participants", (q) =>
        q
          .eq("subjectKind", "dm")
          .eq(
            "participantsKey",
            participantsKeyOf([
              toMemberId(me as string),
              toMemberId(ownerId as string),
            ]),
          ),
      )
      .first();
    if (dm) return { status: "existing", threadId: dm.aggregateId };

    return {
      status: "new",
      copy: await messageCopyViewOf(ctx, copy),
      owner,
      canMessage: await convexConnectionPolicy(ctx).canMessage(
        toMemberId(me as string),
        toMemberId(ownerId as string),
      ),
    };
  },
});
