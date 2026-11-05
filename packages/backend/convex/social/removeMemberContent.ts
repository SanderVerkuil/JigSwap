import type { PaginationResult } from "convex/server";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// Operator tool (SEC-70): remove what one member WROTE for others to read, on request — their copy
// comments (puzzleComments), photo comments (photoComments), puzzle reviews (puzzleReviews), copy
// star reviews (copyReviews) and the written comment of every partner review they gave (`reviews`:
// only `comment` is cleared, the ratings stay because they are the reviewee's reputation).
// Members delete single items themselves in the app; this covers a request for everything, also
// for a member whose account is already gone (the id is all it needs, the users row may be
// missing).
//
// Run from the Convex dashboard or CLI with `{ memberId }`: a DRY RUN by default that only counts
// and logs (social.removeMemberContent); pass `dryRun: false` to act. One table at a time,
// REMOVE_MEMBER_CONTENT_BATCH rows per run, through the member's own index; a run that did not
// finish schedules the next with the cursor, and the last run logs the totals. `table`/`cursor` are
// the resume position the tool passes itself.

/** Rows handled per run. */
export const REMOVE_MEMBER_CONTENT_BATCH = 100;

const TABLES = [
  "puzzleComments",
  "photoComments",
  "puzzleReviews",
  "copyReviews",
  "reviewComments",
] as const;
type ContentTable = (typeof TABLES)[number];

const tableValidator = v.union(
  v.literal("puzzleComments"),
  v.literal("photoComments"),
  v.literal("puzzleReviews"),
  v.literal("copyReviews"),
  v.literal("reviewComments"),
);

const totalsValidator = v.object({
  puzzleComments: v.number(),
  photoComments: v.number(),
  puzzleReviews: v.number(),
  copyReviews: v.number(),
  reviewComments: v.number(),
});
type Totals = Infer<typeof totalsValidator>;

const NO_TOTALS: Totals = {
  puzzleComments: 0,
  photoComments: 0,
  puzzleReviews: 0,
  copyReviews: 0,
  reviewComments: 0,
};

type DeletableRowId =
  | Id<"puzzleComments">
  | Id<"photoComments">
  | Id<"puzzleReviews">
  | Id<"copyReviews">;

type Page = {
  /** Rows on this page that hold the member's content (removed unless dry run). */
  acted: number;
  isDone: boolean;
  continueCursor: string;
};

// One page of one table, through the member's own index. Deletes (or, for partner reviews, clears
// the comment of) each row unless this is a dry run.
const removePage = async (
  ctx: MutationCtx,
  table: ContentTable,
  memberId: Id<"users">,
  cursor: string | null,
  dryRun: boolean,
): Promise<Page> => {
  const opts = { numItems: REMOVE_MEMBER_CONTENT_BATCH, cursor };
  const deleteAll = async (
    page: PaginationResult<{ _id: DeletableRowId }>,
  ): Promise<Page> => {
    if (!dryRun) {
      for (const row of page.page) await ctx.db.delete(row._id);
    }
    return {
      acted: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  };
  switch (table) {
    case "puzzleComments":
      return deleteAll(
        await ctx.db
          .query("puzzleComments")
          .withIndex("by_author", (q) => q.eq("authorId", memberId))
          .paginate(opts),
      );
    case "photoComments":
      return deleteAll(
        await ctx.db
          .query("photoComments")
          .withIndex("by_author", (q) => q.eq("authorId", memberId))
          .paginate(opts),
      );
    case "puzzleReviews":
      return deleteAll(
        await ctx.db
          .query("puzzleReviews")
          .withIndex("by_user_puzzle", (q) => q.eq("userId", memberId))
          .paginate(opts),
      );
    case "copyReviews":
      return deleteAll(
        await ctx.db
          .query("copyReviews")
          .withIndex("by_user_copy", (q) => q.eq("userId", memberId))
          .paginate(opts),
      );
    case "reviewComments": {
      const page = await ctx.db
        .query("reviews")
        .withIndex("by_reviewer", (q) => q.eq("reviewerId", memberId))
        .paginate(opts);
      const withComment = page.page.filter((row) => row.comment !== undefined);
      if (!dryRun) {
        for (const row of withComment) {
          await ctx.db.patch(row._id, { comment: undefined });
        }
      }
      return {
        acted: withComment.length,
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
  }
};

export const removeMemberContent = internalMutation({
  args: {
    memberId: v.id("users"),
    dryRun: v.optional(v.boolean()),
    table: v.optional(tableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    // Running counts carried across runs so the last run logs the whole removal.
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals> => {
    const dryRun = args.dryRun ?? true;
    const table = args.table ?? TABLES[0];
    const page = await removePage(
      ctx,
      table,
      args.memberId,
      args.cursor ?? null,
      dryRun,
    );
    const totals: Totals = {
      ...(args.totals ?? NO_TOTALS),
      [table]: (args.totals ?? NO_TOTALS)[table] + page.acted,
    };

    const next = page.isDone ? TABLES[TABLES.indexOf(table) + 1] : table;
    logEvent({
      event: "social.removeMemberContent",
      outcome: "success",
      member_id: args.memberId,
      dry_run: dryRun,
      table,
      acted: page.acted,
      totals,
      is_done: next === undefined,
    });
    if (next !== undefined) {
      await ctx.scheduler.runAfter(
        0,
        internal.social.removeMemberContent.removeMemberContent,
        {
          memberId: args.memberId,
          dryRun,
          table: next,
          cursor: page.isDone ? null : page.continueCursor,
          totals,
        },
      );
    }
    return totals;
  },
});
