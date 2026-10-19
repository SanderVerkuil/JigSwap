import type {
  AttachableCopySide,
  AttachableCopyView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
} from "../library/canViewCopy";
import { isBlockedEitherWay } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { circleCopyAudience } from "./circleAttachableCopy";
import { messageCopyViewOf } from "./copyCard";
import { readableThreadOf } from "./readModelHelpers";

// How many of the owner's copies are scanned (newest first, by_owner) and how many are returned.
// Search is an in-memory filter over that scan, so a match older than the newest 500 copies is not
// found — far beyond any real collection today; move to a search index if that changes.
const SCAN_CAP = 500;
const RESULT_CAP = 50;

// The copies the caller may attach to a message in a thread, mirroring postMessage's attach gate
// (owned by a participant, viewable by both). `side: "mine"` = the caller's copies the other
// participant can view; `"theirs"` = the other participant's copies the caller can view (the
// owner always can). Readers only (readableThreadOf: ThreadNotFound / NotParticipant, and in a
// circle thread a CURRENT member), as getThreadMessages. A circle thread lists the caller's copies
// passing circleCopyAudience for "mine" (flagged `limitedAudience` when only some members may see
// one) and nothing for "theirs".
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
  handler: async (ctx, args): Promise<AttachableCopyView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { thread } = await readableThreadOf(ctx, args.threadId, me);
    const needle = args.search?.trim().toLowerCase() ?? "";
    // A circle thread has no single other side: "theirs" is empty, and "mine" is the caller's
    // copies passing postMessage's circle rule (circleCopyAudience).
    if (thread.subjectKind === "circle") {
      if (args.side === "theirs") return [];
      const audienceOf = circleCopyAudience(ctx, thread, me);
      return scanAttachable(ctx, me, needle, async (copy) => {
        const audience = await audienceOf(copy);
        return audience === null
          ? null
          : audience === "some"
            ? { limitedAudience: true }
            : {};
      });
    }
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
    return scanAttachable(ctx, owner, needle, async (copy) =>
      (await canViewCopyWithContext(ctx, copy, context)) ? {} : null,
    );
  },
});

// The owner's copies (newest first, SCAN_CAP scanned, RESULT_CAP returned) that pass `attachable`
// (null = not attachable, else extra fields for the option) and match `needle`, as cards.
const scanAttachable = async (
  ctx: QueryCtx,
  owner: Id<"users">,
  needle: string,
  attachable: (
    copy: Doc<"ownedPuzzles">,
  ) => Promise<Pick<AttachableCopyView, "limitedAudience"> | null>,
): Promise<AttachableCopyView[]> => {
  const copies = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_owner", (q) => q.eq("ownerId", owner))
    .order("desc")
    .take(SCAN_CAP);

  const results: AttachableCopyView[] = [];
  for (const copy of copies) {
    if (results.length >= RESULT_CAP) break;
    const extra = await attachable(copy);
    if (extra === null) continue;
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
    results.push({ ...(await messageCopyViewOf(ctx, copy)), ...extra });
  }
  return results;
};
