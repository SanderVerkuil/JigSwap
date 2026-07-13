import {
  type MemberId,
  type NotifyMemberCommand,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { makeNotify } from "./adapters/makeNotify";

// The Notifications subscriber: the bridge from other contexts' event LANGUAGE to member-facing
// notifications. Given a recorded domainEvents row, it enriches via DB reads (to resolve the right
// recipient + relatedId + copy params), and calls NotifyMember once per recipient.
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

const asMember = (id: string): MemberId => toMemberId(id);

// Resolve a member's display name for copy params. Missing user/name ⇒ no param (renderers have
// locale-appropriate fallbacks), never a thrown error — copy must not break delivery.
const memberName = async (
  ctx: MutationCtx,
  id: string | Id<"users">,
): Promise<Record<string, string>> => {
  const user = await ctx.db.get(id as Id<"users">);
  return user?.name ? { actorName: user.name } : {};
};

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

// Resolve a thread's participants from its ThreadId aggregateId.
const loadThread = (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"threads"> | null> =>
  ctx.db
    .query("threads")
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

// Fan a review-request out to every admin except the acting member. Reads the users table's Clerk
// role MIRROR via by_role — acceptable for informational notifications (authorization stays
// JWT-only); a drifted mirror can only mis-route a notification, never grant access.
const adminRecipients = async (
  ctx: MutationCtx,
  excludeUserId: string,
): Promise<Doc<"users">[]> => {
  const admins = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();
  return admins.filter((admin) => (admin._id as string) !== excludeUserId);
};

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
        cmd(
          row.recipientId,
          "trade_request",
          row._id,
          await memberName(ctx, row.initiatorId),
        ),
      ];
    }
    case "ExchangeAccepted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.initiatorId, "trade_accepted", row._id)];
    }
    case "ExchangeRejected": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.initiatorId, "trade_declined", row._id)];
    }
    case "ExchangeCancelled": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.recipientId, "trade_cancelled", row._id)];
    }
    case "ExchangeCompleted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      // The event carries no actor; notify both parties (each gets "the other party" signal).
      return [
        cmd(row.initiatorId, "trade_completed", row._id),
        cmd(row.recipientId, "trade_completed", row._id),
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
      return [cmd(counterparty, "exchange_disputed", row._id)];
    }

    // --- Conversation ---
    case "MessagePosted": {
      // System messages (authorId null) mirror an exchange lifecycle event that already notified
      // through its own case above — notifying here would double up every lifecycle transition.
      const authorId = p.authorId as string | null;
      if (authorId === null || authorId === undefined) return [];
      const thread = await loadThread(ctx, p.threadId as string);
      if (!thread) return [];
      const author = await memberName(ctx, authorId);
      return thread.participants
        .filter((participant) => (participant as string) !== authorId)
        .map((participant) =>
          cmd(participant, "message_received", thread.aggregateId, author),
        );
    }

    // --- Solving ---
    case "GoalAchieved": {
      const goal = await loadGoal(ctx, p.goalId as string);
      if (!goal) return [];
      return [
        cmd(goal.userId, "goal_achieved", goal._id, {
          goalTitle: goal.title,
        }),
      ];
    }

    // --- Reputation ---
    case "PartnerReviewSubmitted": {
      return [
        cmd(p.revieweeId as string, "review_received", p.reviewId as string),
      ];
    }

    // --- Catalog ---
    case "PuzzleDefinitionApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_approved", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "PuzzleDefinitionRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_rejected", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "ChangeProposalApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(p.proposedBy as string, "proposal_approved", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "ChangeProposalRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      const reason = p.reason as string | undefined;
      return [
        cmd(p.proposedBy as string, "proposal_rejected", puzzle._id, {
          puzzleTitle: puzzle.title,
          ...(reason ? { reason } : {}),
        }),
      ];
    }
    case "ChangeProposalFiled": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      const admins = await adminRecipients(ctx, p.proposedBy as string);
      return admins.map((admin) =>
        cmd(
          admin._id,
          "admin_proposal_filed",
          p.changeProposalId as string, // the review route's param — no lookup needed
          puzzle ? { puzzleTitle: puzzle.title } : {},
        ),
      );
    }
    case "PuzzleDefinitionSubmitted": {
      const admins = await adminRecipients(ctx, p.submittedBy as string);
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      return admins.map((admin) =>
        cmd(
          admin._id,
          "admin_definition_submitted",
          puzzle?._id ?? (p.puzzleDefinitionId as string),
          puzzle ? { puzzleTitle: puzzle.title } : {},
        ),
      );
    }

    // --- Social ---
    case "MemberFollowed": {
      // Approval suppression: when this edge came from the target APPROVING a follow request,
      // the followee IS the approver — they already got follow_request_received and just acted
      // on it. Suppress only when the approval is fresh (10 min) so a stale approved row
      // never permanently mutes a later, genuine re-follow of the same pair.
      // Accepted tradeoff: an unfollow + instant re-follow landing inside that same
      // 10-minute post-approval window is also suppressed — indistinguishable here, and
      // rare enough that we prefer it over ever double-notifying an approver.
      // BUT: a token flow (QR/invite) auto-approves the pending row WITHOUT the target acting —
      // approvedViaToken marks those. There the target never approved, so we must NOT suppress:
      // they still deserve to learn they gained a follower (S1).
      const followerId = p.followerId as string;
      const followeeId = p.followeeId as string;
      const request = await ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q
            .eq("requesterId", followerId as Id<"users">)
            .eq("targetId", followeeId as Id<"users">),
        )
        .first();
      if (
        request?.status === "approved" &&
        request.approvedViaToken !== true &&
        request.respondedAt !== undefined &&
        Math.abs(event.occurredAt - request.respondedAt) < 10 * 60 * 1000
      ) {
        return [];
      }
      return [
        cmd(
          followeeId,
          "new_follower",
          followerId, // the follower's users _id; the UI deep-links to /people
          await memberName(ctx, followerId),
        ),
      ];
    }
    case "FollowRequested": {
      return [
        cmd(
          p.targetId as string,
          "follow_request_received",
          p.requesterId as string,
          await memberName(ctx, p.requesterId as string),
        ),
      ];
    }
    case "FollowRequestApproved": {
      return [
        cmd(
          p.requesterId as string,
          "follow_request_approved",
          p.targetId as string,
          await memberName(ctx, p.targetId as string),
        ),
      ];
    }
    // FollowRequestDeclined: DELIBERATELY unmapped — decline is silent (spec).

    default:
      return [];
  }
};

// Build a NotifyMemberCommand. `recipient` is a user id (string or Convex Id); relatedId points at
// the upstream entity's Convex `_id` (opaque to Notifications); `params` carries the render-ready
// values for this type's copy (contract documented in notifications/copy.ts) — rendering happens at
// the edges (web i18n, email templates, push copy table), never here.
const cmd = (
  recipient: string | Id<"users">,
  type: NotifyMemberCommand["type"],
  relatedId: string,
  params: Record<string, string> = {},
): NotifyMemberCommand => ({
  memberId: asMember(recipient as string),
  type,
  params,
  relatedId,
});
