import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { userQuery } from "../users";
import {
  MEMBER_TARGET_KINDS,
  MEMBER_TARGET_LABEL,
} from "./stampModerationAction";

/** Rows per batch: one or two reads and at most one patch each. */
export const BACKFILL_AUDIT_TARGETS_BATCH = 100;

/** A legacy role row's targetId once its member's account is gone: no Clerk id is kept. */
export const DELETED_MEMBER_TARGET_ID = "deleted-member";

type Counts = {
  scanned: number;
  /** Rows given a targetMemberId (the member's account may since have gone). */
  linked: number;
  /** Rows whose member could no longer be found: scrubbed without a link. */
  departed: number;
};

type Patch = Partial<
  Pick<Doc<"moderationActions">, "targetMemberId" | "targetLabel" | "targetId">
>;

const isRoleRow = (row: Doc<"moderationActions">) =>
  row.kind === "role_granted" || row.kind === "role_revoked";

// The member a legacy row is about: a role row keys targetId on their Clerk id, a report row on
// the report, which keeps the reported member's id (also once their account is gone). Undefined
// when a role row's account, or a report row's report, no longer exists.
const legacyMemberOf = async (
  ctx: MutationCtx,
  row: Doc<"moderationActions">,
): Promise<Id<"users"> | undefined> => {
  if (isRoleRow(row)) return (await userQuery(ctx, row.targetId))?._id;
  const reportId = ctx.db.normalizeId("reports", row.targetId);
  return reportId ? (await ctx.db.get(reportId))?.reportedUserId : undefined;
};

// The patch that moves one legacy row to the SEC-57 shape, or null when it needs none.
const patchFor = async (
  ctx: MutationCtx,
  row: Doc<"moderationActions">,
): Promise<{ patch: Patch; linked: boolean } | null> => {
  if (!MEMBER_TARGET_KINDS.has(row.kind)) return null;
  if (row.targetLabel === MEMBER_TARGET_LABEL) return null; // stamped or rewritten already
  const memberId = await legacyMemberOf(ctx, row);
  return {
    patch: {
      targetLabel: MEMBER_TARGET_LABEL,
      ...(memberId ? { targetMemberId: memberId } : {}),
      // A role row's Clerk id goes: the users id, or the deleted marker.
      ...(isRoleRow(row) && { targetId: memberId ?? DELETED_MEMBER_TARGET_ID }),
    },
    linked: memberId !== undefined,
  };
};

// SEC-57 migration: role changes and report decisions used to stamp the member's name (falling
// back to their email) as targetLabel, and a role row's targetId was their Clerk id; both
// outlived account deletion. New rows store targetMemberId and a neutral label. This rewrites
// older rows the same way: a report row is linked through its report, a role row through the
// member's users row (its targetId becomes the users id). A role row whose member is already gone
// keeps no link: its label is neutral and its targetId DELETED_MEMBER_TARGET_ID, and the admin
// read models show "Deleted member". Rows about content are untouched.
//
// A DRY RUN by default: pass `dryRun: false` to write. Pages `moderationActions` and reschedules
// itself; idempotent (a rewritten row carries the neutral label and is skipped).
export const backfillAuditTargets = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(
      v.object({
        scanned: v.number(),
        linked: v.number(),
        departed: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Counts> => {
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db.query("moderationActions").paginate({
      numItems: args.batchSize ?? BACKFILL_AUDIT_TARGETS_BATCH,
      cursor: args.cursor ?? null,
    });

    const batch: Counts = { scanned: 0, linked: 0, departed: 0 };
    for (const row of page.page) {
      batch.scanned++;
      const change = await patchFor(ctx, row);
      if (!change) continue;
      if (change.linked) batch.linked++;
      else batch.departed++;
      if (!dryRun) await ctx.db.patch(row._id, change.patch);
    }

    const totals: Counts = {
      scanned: (args.totals?.scanned ?? 0) + batch.scanned,
      linked: (args.totals?.linked ?? 0) + batch.linked,
      departed: (args.totals?.departed ?? 0) + batch.departed,
    };
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.admin.backfillAuditTargets.backfillAuditTargets,
        {
          dryRun,
          cursor: page.continueCursor,
          batchSize: args.batchSize,
          totals,
        },
      );
    } else {
      logEvent({
        event: "admin.backfillAuditTargets",
        outcome: "success",
        dry_run: dryRun,
        scanned: totals.scanned,
        linked: totals.linked,
        departed: totals.departed,
      });
    }
    return batch;
  },
});
