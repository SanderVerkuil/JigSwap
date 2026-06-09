import { type MemberId, type NotifyMemberCommand, toId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { makeNotify } from "./adapters/makeNotify";

// The Notifications subscriber: the bridge from other contexts' event LANGUAGE to member-facing
// notifications. Given a recorded domainEvents row, it enriches via DB reads (to resolve the right
// recipient + relatedId), pre-renders title/message, and calls NotifyMember once per recipient.
// NotifyMember itself gates on the member's preferences (suppression lives there, not here).
//
// WHY here and not inline in each context: this keeps Notifications a decoupled subscriber — the
// emitting contexts know nothing about notifications; they only publish their domain events.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  const notify = makeNotify(ctx);
  const commands = await translate(ctx, event);
  for (const cmd of commands) {
    await notify(cmd);
  }
};

const asMember = (id: string): MemberId => toId<"MemberId">(id) as MemberId;

// Resolve the persisted exchange row from its ExchangeId aggregateId so we can address the real
// parties and use the Convex `_id` as the notification's relatedId (matching the old inline wording
// + linkage exactly, now async).
const loadExchange = (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"exchanges"> | null> =>
  ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

// Resolve a goal's owner + relatedId from its GoalId aggregateId.
const loadGoal = (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"goals"> | null> =>
  ctx.db
    .query("goals")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

// Resolve a puzzle definition's submitter + relatedId from its PuzzleDefinitionId aggregateId.
const loadPuzzle = (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"puzzles"> | null> =>
  ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

// Map a recorded event to zero or more NotifyMember commands. Unmapped events are a no-op (most
// events have no member-facing notification yet). The `payload` carries the event's data fields
// (branded id strings + epoch-millis dates) as serialised by recordAndSchedule.
const translate = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<NotifyMemberCommand[]> => {
  const p = event.payload as Record<string, unknown>;

  switch (event.name) {
    // --- Exchange ---
    case "ExchangeProposed": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(row.recipientId, "trade_request", "New Exchange Request", "Someone wants to trade for one of your puzzles", row._id),
      ];
    }
    case "ExchangeAccepted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(row.initiatorId, "trade_accepted", "Exchange Accepted", "Your trade request has been accepted!", row._id),
      ];
    }
    case "ExchangeRejected": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(row.initiatorId, "trade_declined", "Exchange Declined", "Your trade request has been declined", row._id),
      ];
    }
    case "ExchangeCancelled": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(row.recipientId, "trade_cancelled", "Exchange Cancelled", "Exchange request has been cancelled", row._id),
      ];
    }
    case "ExchangeCompleted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      // The event carries no actor; notify both parties (each gets "the other party" signal).
      return [
        cmd(row.initiatorId, "trade_completed", "Exchange Completed", "Exchange has been marked as completed", row._id),
        cmd(row.recipientId, "trade_completed", "Exchange Completed", "Exchange has been marked as completed", row._id),
      ];
    }
    case "DisputeRaised": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      // Notify the counterparty (the party who did NOT raise it).
      const raisedBy = p.raisedBy as string;
      const counterparty =
        (raisedBy as unknown as Id<"users">) === row.initiatorId
          ? row.recipientId
          : row.initiatorId;
      return [
        cmd(counterparty, "exchange_disputed", "Exchange Disputed", "The other party has flagged an issue with your exchange", row._id),
      ];
    }

    // --- Solving ---
    case "GoalAchieved": {
      const goal = await loadGoal(ctx, p.goalId as string);
      if (!goal) return [];
      return [
        cmd(goal.userId, "goal_achieved", "Goal Achieved", `You reached your goal "${goal.title}"!`, goal._id),
      ];
    }

    // --- Reputation ---
    case "PartnerReviewSubmitted": {
      return [
        cmd(p.revieweeId as string, "review_received", "New Review", "You received a new partner review", p.reviewId as string),
      ];
    }

    // --- Catalog ---
    case "PuzzleDefinitionApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_approved", "Puzzle Approved", `Your submission "${puzzle.title}" was approved`, puzzle._id),
      ];
    }
    case "PuzzleDefinitionRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_rejected", "Puzzle Rejected", `Your submission "${puzzle.title}" was rejected`, puzzle._id),
      ];
    }

    default:
      return [];
  }
};

// Build a NotifyMemberCommand. `recipient` is a user id (string or Convex Id); relatedId points at
// the upstream entity's Convex `_id` (opaque to Notifications).
const cmd = (
  recipient: string | Id<"users">,
  type: NotifyMemberCommand["type"],
  title: string,
  message: string,
  relatedId: string,
): NotifyMemberCommand => ({
  memberId: asMember(recipient as string),
  type,
  title,
  message,
  relatedId,
});
