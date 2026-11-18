import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

/** Profiles per batch: one read each plus at most one patch. */
export const CLEAR_UNCHOSEN_VISIBILITY_BATCH = 100;

type Counts = { scanned: number; cleared: number; kept: number };

// One-shot repair (ponytail messaging-1, viewing-another-member-1): until that fix, opening a
// profile row (editProfile, arrangeShelf, any save of a legacy row) stored visibility "public" the
// member never chose, which unlocked their logged-out page. Clears `visibility` on every "public"
// row whose member has no ProfileVisibilityChanged event, so it reads as unchosen again (private
// logged out, public in-app). A row with a recorded choice is kept (`kept`); re-running clears
// nothing new.
//
// Only events still in the log count: a choice whose event the domainEvents retention sweep already
// deleted is cleared too. That fails closed (the member looks private to logged-out visitors until
// they toggle again), so compare the dry run's `cleared` with what you expect before applying.
//
// A DRY RUN by default (counts only): pass `apply: true` to write. Pages `profiles` and reschedules
// itself; logs the whole run's totals at the end. Run by an operator
// (docs/deployment/one-shot-migrations.md).
export const clearUnchosenVisibility = internalMutation({
  args: {
    apply: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    totals: v.optional(
      v.object({ scanned: v.number(), cleared: v.number(), kept: v.number() }),
    ),
  },
  handler: async (ctx, args): Promise<Counts> => {
    const apply = args.apply === true;
    const page = await ctx.db.query("profiles").paginate({
      numItems: CLEAR_UNCHOSEN_VISIBILITY_BATCH,
      cursor: args.cursor ?? null,
    });
    // shortcut: every batch re-reads all ProfileVisibilityChanged events, fine while they number in
    // the low thousands; page them into a lookup first if the dry run hits a read limit.
    const choices = await ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", "ProfileVisibilityChanged"))
      .collect();
    const chose = new Set(
      choices.map((event) => (event.payload as { memberId: string }).memberId),
    );

    const batch: Counts = { scanned: 0, cleared: 0, kept: 0 };
    for (const row of page.page) {
      batch.scanned++;
      if (row.visibility !== "public") continue;
      if (chose.has(row.memberId)) {
        batch.kept++;
        continue;
      }
      batch.cleared++;
      if (apply) await ctx.db.patch(row._id, { visibility: undefined });
    }

    const totals: Counts = {
      scanned: (args.totals?.scanned ?? 0) + batch.scanned,
      cleared: (args.totals?.cleared ?? 0) + batch.cleared,
      kept: (args.totals?.kept ?? 0) + batch.kept,
    };
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.social.clearUnchosenVisibility.clearUnchosenVisibility,
        { apply, cursor: page.continueCursor, totals },
      );
      return batch;
    }
    logEvent({
      event: "social.clearUnchosenVisibility",
      outcome: "success",
      dry_run: !apply,
      ...totals,
    });
    return batch;
  },
});
