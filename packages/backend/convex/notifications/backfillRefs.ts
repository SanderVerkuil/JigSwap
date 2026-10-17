import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

// Rows per batch. Each row costs at most a handful of point/index reads (one exchange, thread,
// review, proposal, invite or household lookup; a household's invites or a requester→target pair's
// follow requests, both a few rows) plus one patch, so 100 rows stay far below Convex's
// per-mutation document-read and write limits — the same budget whatsNew/notifyBatch uses.
export const BACKFILL_REFS_BATCH = 100;

type SubjectRow = NonNullable<Doc<"notifications">["subject"]>;
type RefsPatch = {
  actorIds?: Id<"users">[];
  actorCount?: number;
  subject?: SubjectRow;
};
type Counts = { scanned: number; patched: number; skipped: number };

const EXCHANGE_TYPES = new Set<Doc<"notifications">["type"]>([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_cancelled",
  "trade_completed",
  "exchange_disputed",
]);

// Moderator-driven outcomes: subject only, never an actor (the moderator is never exposed).
const PUZZLE_SUBJECT_TYPES = new Set<Doc<"notifications">["type"]>([
  "puzzle_approved",
  "puzzle_rejected",
  "proposal_approved",
  "proposal_rejected",
]);

const withActor = (actor: Id<"users"> | null | undefined): RefsPatch =>
  actor ? { actorIds: [actor], actorCount: 1 } : {};

// Derive the refs N2's subscriber would have written for this row's type, from the row's
// relatedId plus a lookup of the upstream entity. Anything not derivable with certainty stays
// absent: the read model falls back to params + generic copy for those.
const deriveRefs = async (
  ctx: MutationCtx,
  row: Doc<"notifications">,
): Promise<RefsPatch> => {
  const relatedId = row.relatedId;
  if (relatedId === undefined) return {};
  const db = ctx.db;

  if (EXCHANGE_TYPES.has(row.type)) {
    // relatedId is the exchange row's `_id`; the subject is its aggregateId. Every exchange type's
    // actor is the recipient's counterparty (for a dispute that is whoever raised it).
    const exchangeId = db.normalizeId("exchanges", relatedId);
    const exchange = exchangeId ? await db.get(exchangeId) : null;
    if (!exchange) return {};
    const counterparty =
      exchange.initiatorId === row.userId
        ? exchange.recipientId
        : exchange.recipientId === row.userId
          ? exchange.initiatorId
          : null;
    return {
      ...withActor(counterparty),
      ...(exchange.aggregateId
        ? {
            subject: { kind: "exchange", exchangeId: exchange.aggregateId },
          }
        : {}),
    };
  }
  if (PUZZLE_SUBJECT_TYPES.has(row.type)) {
    const puzzleId = db.normalizeId("puzzles", relatedId);
    return puzzleId ? { subject: { kind: "puzzle", puzzleId } } : {};
  }

  switch (row.type) {
    case "message_received": {
      const thread = await db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", relatedId))
        .unique();
      if (!thread) return {};
      // The author is only certain in a 2-participant thread the recipient belongs to.
      const other =
        thread.participants.length === 2 &&
        thread.participants.includes(row.userId)
          ? thread.participants.find((p) => p !== row.userId)
          : undefined;
      return {
        ...withActor(other),
        subject: { kind: "thread", threadId: thread.aggregateId },
      };
    }
    case "review_received": {
      const review = await db
        .query("reviews")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", relatedId))
        .unique();
      if (!review || review.revieweeId !== row.userId) return {};
      return {
        ...withActor(review.reviewerId),
        subject: { kind: "review", reviewId: relatedId },
      };
    }
    case "goal_achieved": {
      const goalId = db.normalizeId("goals", relatedId);
      return goalId ? { subject: { kind: "goal", goalId } } : {};
    }
    case "photo_removed": {
      const copyId = db.normalizeId("ownedPuzzles", relatedId);
      return copyId ? { subject: { kind: "copy", copyId } } : {};
    }
    case "admin_proposal_filed": {
      const proposal = await db
        .query("puzzleChangeProposals")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", relatedId))
        .unique();
      if (!proposal) return {};
      return {
        ...withActor(proposal.proposedBy),
        subject: { kind: "changeProposal", proposalId: relatedId },
      };
    }
    case "admin_definition_submitted": {
      // relatedId is the puzzle `_id` (or its aggregateId when the subscriber could not resolve
      // the row — then, as there, no subject). The actor is the submitter.
      const puzzleId = db.normalizeId("puzzles", relatedId);
      if (!puzzleId) return {};
      const puzzle = await db.get(puzzleId);
      return {
        ...withActor(puzzle?.submittedBy),
        subject: { kind: "puzzle", puzzleId },
      };
    }
    case "new_follower":
    case "follow_request_approved":
      // relatedId is the follower / approving target: the actor is the subject.
      return withActor(db.normalizeId("users", relatedId));
    case "follow_request_received": {
      const requesterId = db.normalizeId("users", relatedId);
      if (!requesterId) return {};
      // The request that triggered this row: the newest one created at or before it.
      const requests = await db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", requesterId).eq("targetId", row.userId),
        )
        .collect();
      const request = requests
        .filter((r) => r.createdAt <= row.createdAt)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        ...withActor(requesterId),
        ...(request
          ? {
              subject: {
                kind: "followRequest",
                requestId: request.aggregateId,
              },
            }
          : {}),
      };
    }
    case "household_invite_received": {
      const invite = await db
        .query("householdInvites")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", relatedId))
        .unique();
      if (!invite || invite.inviteeId !== row.userId) return {};
      return {
        ...withActor(invite.inviterId),
        subject: { kind: "householdInvite", inviteId: relatedId },
      };
    }
    case "household_invite_accepted": {
      // relatedId is the HouseholdId. The invitee is the one whose acceptance of THIS recipient's
      // invite lies nearest the row's createdAt; no accepted invite ⇒ no actor.
      const household = await db
        .query("households")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", relatedId))
        .unique();
      const invites = await db
        .query("householdInvites")
        .withIndex("by_household", (q) => q.eq("householdId", relatedId))
        .collect();
      const distance = (respondedAt: number) =>
        Math.abs(respondedAt - row.createdAt);
      const nearest = invites
        .filter(
          (i): i is typeof i & { respondedAt: number } =>
            i.inviterId === row.userId &&
            i.status === "accepted" &&
            i.respondedAt !== undefined,
        )
        .sort((a, b) => distance(a.respondedAt) - distance(b.respondedAt))[0];
      return {
        ...withActor(nearest?.inviteeId),
        ...(household
          ? { subject: { kind: "household", householdId: relatedId } }
          : {}),
      };
    }
    case "whats_new":
      return { subject: { kind: "whatsNew", entryId: relatedId } };
    default:
      // exchange_proposed / puzzle_favorited: the subscriber writes no refs for these.
      return {};
  }
};

// One-shot, idempotent backfill of actor/subject refs onto notification rows written before N2
// (spec 5.6). Pages through `notifications` and reschedules itself until the table is exhausted;
// each batch is its own transaction. Only `actorIds`/`actorCount`/`subject` are ever written —
// never isRead/createdAt/params/type — and rows already carrying `subject` or `actorIds` are
// skipped, so re-running patches nothing new. `dryRun` walks every page and counts without writing.
export const backfillRefs = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        patched: v.number(),
        skipped: v.number(),
      }),
    ),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db
      .query("notifications")
      .paginate({ numItems: BACKFILL_REFS_BATCH, cursor: cursor ?? null });

    const batch: Counts = { scanned: 0, patched: 0, skipped: 0 };
    for (const row of page.page) {
      batch.scanned++;
      if (row.subject !== undefined || row.actorIds !== undefined) {
        batch.skipped++;
        continue;
      }
      const patch = await deriveRefs(ctx, row);
      if (Object.keys(patch).length === 0) {
        batch.skipped++;
        continue;
      }
      if (!dryRun) await ctx.db.patch(row._id, patch);
      batch.patched++;
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      patched: (totals?.patched ?? 0) + batch.patched,
      skipped: (totals?.skipped ?? 0) + batch.skipped,
    };
    console.log(
      `notifications/backfillRefs${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.backfillRefs.backfillRefs,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          ...(dryRun ? { dryRun } : {}),
        },
      );
    }
    return batch;
  },
});
