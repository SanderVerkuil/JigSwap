import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

// Rows per batch: each costs at most one users point read (memoised per batch), so a batch stays
// far inside Convex's per-transaction limits. `batchSize` overrides it, clamped to 1..MAX.
export const BACKFILL_DELETED_MEMBER_DATA_BATCH = 200;
export const BACKFILL_DELETED_MEMBER_DATA_MAX_BATCH = 1000;

// The tables that hold what the later purge phases clean up, walked in this order. Each names the
// member it belongs to in one column.
const TABLES = ["ownedPuzzles", "circles", "householdMembers"] as const;
type Table = (typeof TABLES)[number];
const tableValidator = v.union(
  v.literal("ownedPuzzles"),
  v.literal("circles"),
  v.literal("householdMembers"),
);

// One page of `table`, as the member id each row belongs to.
const pageOf = async (
  ctx: MutationCtx,
  table: Table,
  opts: { cursor: string | null; numItems: number },
): Promise<{
  memberIds: Id<"users">[];
  isDone: boolean;
  continueCursor: string;
}> => {
  switch (table) {
    case "ownedPuzzles": {
      const page = await ctx.db.query("ownedPuzzles").paginate(opts);
      return { ...page, memberIds: page.page.map((row) => row.ownerId) };
    }
    case "circles": {
      const page = await ctx.db.query("circles").paginate(opts);
      return { ...page, memberIds: page.page.map((row) => row.ownerId) };
    }
    case "householdMembers": {
      const page = await ctx.db.query("householdMembers").paginate(opts);
      return { ...page, memberIds: page.page.map((row) => row.memberId) };
    }
  }
};

/**
 * One-shot backfill for accounts deleted before the purge covered their library (spec 2026-10-19
 * deleted member ghost, "Already-deleted accounts"). Pages through `ownedPuzzles`, `circles` and
 * `householdMembers` and collects every member id whose `users` row is missing or inactive (deleted
 * or tombstoned). A dry run (the DEFAULT) only reports them; a real run (`dryRun: false`) schedules
 * conversation/purgeMemberMessagingData for each, starting at its `exchangesOpen` phase (the
 * earlier phases already ran when the account was deleted, and are safe to skip). Reschedules
 * itself page by page and table by table; `found` carries the ids seen so far, so each is reported
 * and scheduled once. Each batch logs its findings; the last logs the whole list. Re-running is
 * harmless: a purged member leaves nothing behind to find. Run by an operator, with approval.
 */
export const backfillDeletedMemberData = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    table: v.optional(tableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    found: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const table = args.table ?? TABLES[0];
    const numItems = Math.max(
      1,
      Math.min(
        BACKFILL_DELETED_MEMBER_DATA_MAX_BATCH,
        Math.floor(args.batchSize ?? BACKFILL_DELETED_MEMBER_DATA_BATCH),
      ),
    );
    const page = await pageOf(ctx, table, {
      cursor: args.cursor ?? null,
      numItems,
    });

    const seen = new Set<string>(args.found ?? []);
    const checked = new Set<string>();
    const departed: Id<"users">[] = [];
    for (const memberId of page.memberIds) {
      if (seen.has(memberId) || checked.has(memberId)) continue;
      checked.add(memberId);
      const user = await ctx.db.get(memberId);
      if (user?.isActive === true) continue;
      departed.push(memberId);
    }

    if (!dryRun) {
      for (const memberId of departed) {
        await ctx.scheduler.runAfter(
          0,
          internal.conversation.purgeMemberMessagingData
            .purgeMemberMessagingData,
          { memberId, phase: "exchangesOpen" },
        );
      }
    }

    const found = [...(args.found ?? []), ...departed];
    const nextTable = page.isDone ? TABLES[TABLES.indexOf(table) + 1] : table;
    const isDone = nextTable === undefined;
    console.log(
      `conversation/backfillDeletedMemberData${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({
        table,
        scanned: page.memberIds.length,
        departed,
        isDone,
        ...(isDone ? { found } : {}),
      }),
    );
    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversation.backfillDeletedMemberData
          .backfillDeletedMemberData,
        {
          dryRun,
          table: nextTable,
          cursor: page.isDone ? null : page.continueCursor,
          found,
          ...(args.batchSize !== undefined && { batchSize: args.batchSize }),
        },
      );
    }
    return { table, departed, found, isDone };
  },
});
