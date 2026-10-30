import type { InboxThreadView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { inboxRowOf } from "./getMyInbox";
import { participantRowOf, threadRowByAggregateId } from "./readModelHelpers";

// One thread's inbox row, for the open thread's header (/messages/$threadId): the same view
// getMyInbox lists, wherever the thread sits in the caller's inbox, so a deep link to an old thread
// keeps its header now that the inbox is paged. Null for anything the caller's inbox would not list
// for them: no such thread, not a participant (no participant row), a circle thread they may not
// read (no current seat) or that has nothing for them yet, an exchange whose subject is gone. Null
// rather than an error, so it never tells a non-participant whether the thread exists; the thread's
// messages (listThreadMessages) carry the NotParticipant error.
export const getInboxThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<InboxThreadView | null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const thread = await threadRowByAggregateId(ctx, args.threadId);
    if (!thread || !thread.participants.includes(me)) return null;
    const membership = await participantRowOf(ctx, thread.aggregateId, me);
    if (!membership) return null;
    return inboxRowOf(ctx, thread, membership, me);
  },
});
