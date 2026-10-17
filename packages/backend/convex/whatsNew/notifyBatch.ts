import { toMemberId, unreadWhatsNewEntryIds } from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { whatsNewManifest } from "./manifest";
import { publicationOf } from "./publications";
import { readStateOf } from "./readState";

// Members per batch. Each member costs a read-state read plus the notify path (preference read,
// possibly a default-preference insert, the in-app insert and a push schedule), so 100 stays far
// below Convex's per-mutation read/write limits.
export const WHATS_NEW_NOTIFY_BATCH = 100;

// One page of the whats_new fan-out for a published entry (scheduled by publishPending, then by
// itself until the users table is exhausted). Each batch is its own transaction: its notifications
// and the scheduling of the next batch commit together, and Convex runs a scheduled mutation
// exactly once, so no member is notified twice. Recipients follow the What's new unread rule
// (account created before publishedAt, entry not seen yet); NotifyMember applies the member's
// preferences per channel, exactly as for every other notification.
export const notifyBatch = internalMutation({
  args: { entryId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { entryId, cursor }) => {
    const entry = whatsNewManifest().find((e) => e.id === entryId);
    const publication = await publicationOf(ctx, entryId);
    // The entry left the manifest mid fan-out (a later deploy removed it): stop quietly.
    if (!entry || !publication) return;

    const page = await ctx.db
      .query("users")
      .paginate({ numItems: WHATS_NEW_NOTIFY_BATCH, cursor });
    const notify = makeNotify(ctx);
    for (const user of page.page) {
      const readState = await readStateOf(ctx, user._id);
      const unread = unreadWhatsNewEntryIds([entry], {
        memberCreatedAt: user.createdAt,
        seenIds: readState?.seenEntryIds ?? [],
      });
      if (unread.length === 0) continue;
      await notify({
        memberId: toMemberId(user._id),
        type: "whats_new",
        relatedId: entry.id,
        subject: { kind: "whatsNew", entryId: entry.id },
      });
    }

    if (page.isDone) {
      await ctx.db.patch(publication._id, { completedAt: Date.now() });
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.whatsNew.notifyBatch.notifyBatch,
        { entryId, cursor: page.continueCursor },
      );
    }
  },
});
