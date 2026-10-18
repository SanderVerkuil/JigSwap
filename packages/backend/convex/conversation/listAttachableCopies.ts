import type { AttachableCopySide, MessageCopyView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
} from "../library/canViewCopy";
import { isBlockedEitherWay } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { messageCopyViewOf } from "./copyCard";
import { threadRowByAggregateId } from "./readModelHelpers";

// How many of the owner's copies are scanned (newest first, by_owner) and how many are returned.
// Search is an in-memory filter over that scan, so a match older than the newest 500 copies is not
// found — far beyond any real collection today; move to a search index if that changes.
const SCAN_CAP = 500;
const RESULT_CAP = 50;

// The copies the caller may attach to a message in a thread, mirroring postMessage's attach gate
// (owned by a participant, viewable by both). `side: "mine"` = the caller's copies the other
// participant can view; `"theirs"` = the other participant's copies the caller can view (the
// owner always can). Participants only (ThreadNotFound / NotParticipant, as getThreadMessages).
// An anonymised other member yields [] for "theirs": listing their copies would tie the hidden
// member to identifiable copies, and the picker hides their tab anyway. A pair blocked either way
// yields [] for both sides (postMessage refuses the post anyway). Newest copies first;
// `search` is a case-insensitive substring match on title or brand.
export const listAttachableCopies = query({
  args: {
    threadId: v.string(),
    side: v.union(v.literal("mine"), v.literal("theirs")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MessageCopyView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const thread = await threadRowByAggregateId(ctx, args.threadId);
    if (!thread) {
      throw new ConvexError({
        code: "ThreadNotFound",
        message: "Thread not found",
      });
    }
    if (!thread.participants.includes(me)) {
      throw new ConvexError({
        code: "NotParticipant",
        message: "Only participants may read a thread",
      });
    }
    // The picker is pair-shaped ("mine" for the one other side, "theirs" from them). A circle
    // thread has no single other side, so it lists nothing here; postMessage's isAttachable still
    // applies the circle rule (owner is a participant, every participant may view the copy).
    if (thread.subjectKind === "circle") return [];
    const other = thread.participants.find((p) => p !== me);
    if (!other) return [];
    if (await isBlockedEitherWay(ctx, me, other)) return [];

    let owner: Id<"users">;
    let viewer: Id<"users">;
    const side: AttachableCopySide = args.side;
    if (side === "mine") {
      owner = me;
      viewer = other;
    } else {
      const projected = await projectMemberIdentity(
        ctx,
        me,
        other,
        thread.aggregateId,
      );
      if (projected.anonymous) return [];
      owner = other;
      viewer = me;
    }

    const context = await buildCopyViewContext(ctx, viewer);
    const needle = args.search?.trim().toLowerCase() ?? "";
    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .order("desc")
      .take(SCAN_CAP);

    const results: MessageCopyView[] = [];
    for (const copy of copies) {
      if (results.length >= RESULT_CAP) break;
      if (!(await canViewCopyWithContext(ctx, copy, context))) continue;
      if (needle) {
        // Same snapshot-first precedence as the card, checked before resolving its cover URL.
        const puzzle = await ctx.db.get(copy.puzzleId);
        const title = copy.snapshot?.title ?? puzzle?.title ?? "";
        const brand = copy.snapshot?.brand ?? puzzle?.brand ?? "";
        if (
          !title.toLowerCase().includes(needle) &&
          !brand.toLowerCase().includes(needle)
        ) {
          continue;
        }
      }
      results.push(await messageCopyViewOf(ctx, copy));
    }
    return results;
  },
});
