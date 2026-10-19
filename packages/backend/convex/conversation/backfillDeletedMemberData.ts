import type { PaginationResult } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { scrubDeletedCopyEvent, type CopyExists } from "./purgeMemberEvents";

// Rows per batch: each costs at most one users point read (memoised per batch), so a batch stays
// far inside Convex's per-transaction limits. `batchSize` overrides it, clamped to 1..MAX.
export const BACKFILL_DELETED_MEMBER_DATA_BATCH = 200;
export const BACKFILL_DELETED_MEMBER_DATA_MAX_BATCH = 1000;

// The tables that hold what the later purge phases clean up, walked in this order. Each row names
// the member(s) it belongs to; an exchange or a loan names both parties, an event any member its
// payload mentions (so a member who left nothing but events is found, and their purge scrubs them).
const TABLES = [
  "exchanges",
  "loans",
  "ownedPuzzles",
  "ownedPuzzleImages",
  "completions",
  "goals",
  "collections",
  "categories",
  "circles",
  "householdMembers",
  "domainEvents",
] as const;
type Table = (typeof TABLES)[number];
const tableValidator = v.union(
  v.literal("exchanges"),
  v.literal("loans"),
  v.literal("ownedPuzzles"),
  v.literal("ownedPuzzleImages"),
  v.literal("completions"),
  v.literal("goals"),
  v.literal("collections"),
  v.literal("categories"),
  v.literal("circles"),
  v.literal("householdMembers"),
  v.literal("domainEvents"),
);

type PageOpts = { cursor: string | null; numItems: number };
type MemberPage = {
  memberIds: Id<"users">[];
  isDone: boolean;
  continueCursor: string;
  // domainEvents only: copy-keyed events whose copy is gone and that still carry personal fields.
  deletedCopyEvents?: number;
};

const idsOf = async <R>(
  query: { paginate(opts: PageOpts): Promise<PaginationResult<R>> },
  opts: PageOpts,
  members: (row: R) => Array<Id<"users"> | undefined>,
): Promise<MemberPage> => {
  const page = await query.paginate(opts);
  return {
    isDone: page.isDone,
    continueCursor: page.continueCursor,
    memberIds: page.page
      .flatMap(members)
      .filter((id): id is Id<"users"> => id !== undefined),
  };
};

// Every string anywhere in an event payload.
const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
};

// One page of `table`, as the member ids its rows belong to.
const pageOf = async (
  ctx: MutationCtx,
  table: Table,
  opts: PageOpts,
  dryRun: boolean,
): Promise<MemberPage> => {
  switch (table) {
    case "exchanges":
      return idsOf(ctx.db.query("exchanges"), opts, (row) => [
        row.initiatorId,
        row.recipientId,
      ]);
    case "loans":
      return idsOf(ctx.db.query("loans"), opts, (row) => [
        row.lenderId,
        row.borrowerId,
      ]);
    case "ownedPuzzles":
      return idsOf(ctx.db.query("ownedPuzzles"), opts, (row) => [row.ownerId]);
    case "ownedPuzzleImages":
      return idsOf(ctx.db.query("ownedPuzzleImages"), opts, (row) => [
        row.uploaderId,
      ]);
    case "completions":
      return idsOf(ctx.db.query("completions"), opts, (row) => [row.userId]);
    case "goals":
      return idsOf(ctx.db.query("goals"), opts, (row) => [row.userId]);
    case "collections":
      return idsOf(ctx.db.query("collections"), opts, (row) => [row.userId]);
    case "categories":
      return idsOf(ctx.db.query("categories"), opts, (row) => [row.userId]);
    case "circles":
      return idsOf(ctx.db.query("circles"), opts, (row) => [row.ownerId]);
    case "householdMembers":
      return idsOf(ctx.db.query("householdMembers"), opts, (row) => [
        row.memberId,
      ]);
    // An event names members anywhere in its untyped payload: every string that is a users id.
    // An event that names only a copy (CopyDetailsUpdated and its notes) leads to no member, so
    // the walk scrubs it itself once its copy is gone (scrubDeletedCopyEvent; counted on a dry
    // run): a copy deleted before the purge covered this has no purge left to do it.
    case "domainEvents": {
      const page = await ctx.db.query("domainEvents").paginate(opts);
      const copyExists: CopyExists = new Map();
      let deletedCopyEvents = 0;
      for (const event of page.page) {
        if (await scrubDeletedCopyEvent(ctx, event, copyExists, dryRun)) {
          deletedCopyEvents += 1;
        }
      }
      return {
        isDone: page.isDone,
        continueCursor: page.continueCursor,
        memberIds: page.page
          .flatMap((row) => stringsIn(row.payload))
          .map((s) => ctx.db.normalizeId("users", s))
          .filter((id): id is Id<"users"> => id !== null),
        deletedCopyEvents,
      };
    }
  }
};

/**
 * One-shot backfill for accounts deleted before the purge covered their library (spec 2026-10-19
 * deleted member ghost, "Already-deleted accounts"). Pages through every table the later purge
 * phases clean up (TABLES) and collects every member id whose `users` row is missing or inactive
 * (deleted or tombstoned). A dry run (the DEFAULT) only reports them; a real run (`dryRun: false`) schedules
 * conversation/purgeMemberMessagingData for each, starting at its `exchangesOpen` phase (the
 * earlier phases already ran when the account was deleted, and are safe to skip). Reschedules
 * itself page by page and table by table; `found` carries the ids seen so far, so each is reported
 * and scheduled once. Its domainEvents walk also drops the personal fields (a copy's notes) from
 * events keyed by a copy that no longer exists, or only counts them on a dry run
 * (`deletedCopyEvents`). Each batch logs its findings; the last logs the whole list. Re-running is
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
    const page = await pageOf(
      ctx,
      table,
      { cursor: args.cursor ?? null, numItems },
      dryRun,
    );

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
        ...(page.deletedCopyEvents !== undefined && {
          deletedCopyEvents: page.deletedCopyEvents,
        }),
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
    return {
      table,
      departed,
      found,
      isDone,
      deletedCopyEvents: page.deletedCopyEvents ?? 0,
    };
  },
});
