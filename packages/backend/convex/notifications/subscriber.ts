import {
  toMemberId,
  type Channel,
  type MemberId,
  type NotificationSubject,
  type NotifyMemberCommand,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { blockStateBetween, isBlockedEitherWay } from "../social/blocks";
import { makeNotify } from "./adapters/makeNotify";
import { isViewingMessages } from "./presenceGate";
import { armThreadDigest } from "./threadDigest";

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
  const circleThreads = new Map<string, Promise<boolean>>();
  for (const cmd of commands) {
    // Blocks are silent (spec 2.6): nothing a member blocked either way with the recipient does
    // reaches them. The one place every notification type passes through. Exception: the
    // lifecycle of an exchange that was already under way continues after a block, so its
    // notifications still arrive, but without the actor (their fallback copy names nobody).
    if (
      cmd.actorId !== undefined &&
      (await blocksSilence(ctx, cmd, circleThreads))
    ) {
      if (!EXCHANGE_LIFECYCLE_TYPES.has(cmd.type)) continue;
      const { actorId: _actor, ...withoutActor } = cmd;
      await notify(withoutActor);
      continue;
    }
    await notify(cmd);
    // A circle message is never emailed on its own: it may arm the member's delayed digest.
    if (
      cmd.type === "circle_message_received" &&
      cmd.subject?.kind === "thread"
    ) {
      await armThreadDigest(ctx, cmd.subject.threadId, cmd.memberId);
    }
  }
};

// Whether a block keeps `cmd` from its recipient. Either way, except for a message in a circle
// thread: there only the RECIPIENT's block on the author silences it. Dropping the blocker's
// messages to the member they blocked would tell that member about the block, which in a circle
// is meant to stay silent (spec 5.3).
const blocksSilence = async (
  ctx: MutationCtx,
  cmd: NotifyMemberCommand,
  circleThreads: Map<string, Promise<boolean>>,
): Promise<boolean> => {
  const actorId = cmd.actorId!;
  const threadId =
    (cmd.type === "message_received" ||
      cmd.type === "circle_message_received") &&
    cmd.subject?.kind === "thread"
      ? cmd.subject.threadId
      : undefined;
  if (threadId !== undefined) {
    let isCircle = circleThreads.get(threadId);
    if (!isCircle) {
      isCircle = loadThread(ctx, threadId).then(
        (thread) => thread?.subjectKind === "circle",
      );
      circleThreads.set(threadId, isCircle);
    }
    if (await isCircle) {
      return (await blockStateBetween(ctx, cmd.memberId, actorId)) === "byMe";
    }
  }
  return isBlockedEitherWay(ctx, actorId, cmd.memberId);
};

const CIRCLE_MESSAGE_CHANNELS: readonly Channel[] = ["inApp", "push"];

// Each current circle member's floor in the thread, from its participant rows: the later of
// their row's and their seat's joinedAt. Members without a seat, or with a row lacking joinedAt,
// are absent.
const circleFloors = async (
  ctx: MutationCtx,
  thread: Doc<"threads">,
  rows: readonly Doc<"threadParticipants">[],
): Promise<Map<string, number>> => {
  const floors = new Map<string, number>();
  if (thread.circleId === undefined) return floors;
  const circleId = thread.circleId;
  const circle = await ctx.db
    .query("circles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
    .unique();
  const seatOf = new Map(
    (circle?.memberships ?? []).map((m) => [m.memberId as string, m.joinedAt]),
  );
  for (const row of rows) {
    const seat = seatOf.get(row.memberId as string);
    if (seat !== undefined && row.joinedAt !== undefined) {
      floors.set(row.memberId as string, Math.max(seat, row.joinedAt));
    }
  }
  return floors;
};

// Exchange lifecycle notifications that keep flowing for a blocked pair (an accepted exchange
// can still be completed, cancelled or disputed; a block declines or cancels pending
// proposals). Proposal notifications aren't here: proposing is refused for a blocked pair. No
// loan notification types exist yet; loan lifecycle types belong here when they do.
const EXCHANGE_LIFECYCLE_TYPES: ReadonlySet<NotifyMemberCommand["type"]> =
  new Set([
    "trade_accepted",
    "trade_declined",
    "trade_cancelled",
    "trade_completed",
    "exchange_disputed",
  ]);

const asMember = (id: string): MemberId => toMemberId(id);

// Resolve a member's display name for copy params. Missing user/name ⇒ no param (renderers have
// locale-appropriate fallbacks), never a thrown error — copy must not break delivery.
const memberName = async (
  ctx: MutationCtx,
  id: string | Id<"users">,
): Promise<Record<string, string>> => {
  const user = await ctx.db.get(id as Id<"users">);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_member", (q) => q.eq("memberId", id as Id<"users">))
    .unique();
  // Profile display name first, then account name/username. Never the email: the recipient is
  // another member.
  const actorName = memberDisplayNameOf(user, profile);
  return actorName ? { actorName } : {};
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
          { actor: row.initiatorId, subject: exchangeSubject(p) },
        ),
      ];
    }
    case "ExchangeAccepted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(
          row.initiatorId,
          "trade_accepted",
          row._id,
          {},
          {
            actor: row.recipientId,
            subject: exchangeSubject(p),
          },
        ),
      ];
    }
    case "ExchangeRejected": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(
          row.initiatorId,
          "trade_declined",
          row._id,
          {},
          {
            actor: row.recipientId,
            subject: exchangeSubject(p),
          },
        ),
      ];
    }
    case "ExchangeCancelled": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(
          row.recipientId,
          "trade_cancelled",
          row._id,
          {},
          {
            actor: row.initiatorId,
            subject: exchangeSubject(p),
          },
        ),
      ];
    }
    case "ExchangeCompleted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      // The event carries no actor; notify both parties, each with the OTHER party as the actor.
      return [
        cmd(
          row.initiatorId,
          "trade_completed",
          row._id,
          {},
          {
            actor: row.recipientId,
            subject: exchangeSubject(p),
          },
        ),
        cmd(
          row.recipientId,
          "trade_completed",
          row._id,
          {},
          {
            actor: row.initiatorId,
            subject: exchangeSubject(p),
          },
        ),
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
        cmd(
          counterparty,
          "exchange_disputed",
          row._id,
          {},
          {
            actor: raisedBy,
            subject: exchangeSubject(p),
          },
        ),
      ];
    }

    // --- Conversation ---
    case "MessagePosted": {
      // System messages (authorId null) mirror an exchange lifecycle event that already notified
      // through its own case above — notifying here would double up every lifecycle transition.
      const authorId = p.authorId as string | null;
      if (authorId === null || authorId === undefined) return [];
      const thread = await loadThread(ctx, p.threadId as string);
      if (!thread) return [];
      // No name snapshot for a DM or a circle thread: the sender may be anonymous to the recipient
      // (resolved at read and send time through the privacy rules), so a stored name must never
      // be there to leak.
      const author =
        thread.subjectKind === "exchange"
          ? await memberName(ctx, authorId)
          : {};
      // A circle thread notifies only members who can see the message: a current seat (an
      // ex-member whose participant sync is pending or failed gets nothing) and a floor before it
      // (the later of their row's and seat's joinedAt; a row without one fails closed). A blocked
      // author's message is dropped for the blocker below (handleDomainEvent). A member who muted
      // the thread gets nothing from it on any channel.
      // One scan of the participant rows serves both the floors and the mutes.
      const rows = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) =>
          q.eq("threadAggregateId", thread.aggregateId),
        )
        .collect();
      const circle = thread.subjectKind === "circle";
      const floorOf = circle
        ? await circleFloors(ctx, thread, rows)
        : new Map<string, number>();
      const mutedBy = new Set(
        rows
          .filter((row) => row.muted === true)
          .map((row) => row.memberId as string),
      );
      const recipients = thread.participants.filter(
        (participant) =>
          (participant as string) !== authorId &&
          !mutedBy.has(participant as string) &&
          (!circle ||
            (floorOf.get(participant as string) ?? Infinity) <
              event.occurredAt),
      );
      // Presence suppression: a recipient already on /messages sees the message live (plus an
      // in-tab toast) — creating a bell row or emailing them would double-notify. Fail-open:
      // a presence error delivers normally.
      const absent: typeof recipients = [];
      for (const participant of recipients) {
        if (!(await isViewingMessages(ctx, participant as string))) {
          absent.push(participant);
        }
      }
      // A circle thread's messages are their own type, and never emailed one by one: email
      // comes only as the delayed per-thread digest (armed in handleDomainEvent).
      return absent.map((participant) => ({
        ...cmd(
          participant,
          circle ? "circle_message_received" : "message_received",
          thread.aggregateId,
          author,
          {
            actor: authorId,
            subject: { kind: "thread", threadId: thread.aggregateId },
          },
        ),
        ...(circle && { channels: CIRCLE_MESSAGE_CHANNELS }),
      }));
    }

    // --- Solving ---
    case "GoalAchieved": {
      const goal = await loadGoal(ctx, p.goalId as string);
      if (!goal) return [];
      return [
        cmd(
          goal.userId,
          "goal_achieved",
          goal._id,
          { goalTitle: goal.title },
          { subject: { kind: "goal", goalId: goal._id } },
        ),
      ];
    }

    // --- Reputation ---
    case "PartnerReviewSubmitted": {
      // The rating is snapshotted into params (immutable once submitted) so every channel can
      // show it without a review lookup.
      const rating = p.rating;
      return [
        cmd(
          p.revieweeId as string,
          "review_received",
          p.reviewId as string,
          typeof rating === "number" ? { rating: String(rating) } : {},
          {
            actor: p.reviewerId as string,
            subject: { kind: "review", reviewId: p.reviewId as string },
          },
        ),
      ];
    }

    // --- Catalog ---
    case "PuzzleDefinitionApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(
          puzzle.submittedBy,
          "puzzle_approved",
          puzzle._id,
          { puzzleTitle: puzzle.title },
          { subject: puzzleSubject(puzzle) }, // moderator-driven: no actor
        ),
      ];
    }
    case "PuzzleDefinitionRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(
          puzzle.submittedBy,
          "puzzle_rejected",
          puzzle._id,
          { puzzleTitle: puzzle.title },
          { subject: puzzleSubject(puzzle) }, // moderator-driven: no actor
        ),
      ];
    }
    case "ChangeProposalApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(
          p.proposedBy as string,
          "proposal_approved",
          puzzle._id,
          { puzzleTitle: puzzle.title },
          { subject: puzzleSubject(puzzle) }, // moderator-driven: no actor
        ),
      ];
    }
    case "ChangeProposalRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      const reason = p.reason as string | undefined;
      return [
        cmd(
          p.proposedBy as string,
          "proposal_rejected",
          puzzle._id,
          { puzzleTitle: puzzle.title, ...(reason ? { reason } : {}) },
          { subject: puzzleSubject(puzzle) }, // moderator-driven: no actor
        ),
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
          {
            actor: p.proposedBy as string,
            subject: {
              kind: "changeProposal",
              proposalId: p.changeProposalId as string,
            },
          },
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
          // The puzzle subject is a Convex `_id`: omitted when the row cannot be resolved.
          {
            actor: p.submittedBy as string,
            ...(puzzle ? { subject: puzzleSubject(puzzle) } : {}),
          },
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
          { actor: followerId }, // the follower IS the subject
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
          {
            actor: p.requesterId as string,
            subject: {
              kind: "followRequest",
              requestId: p.requestId as string,
            },
          },
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
          { actor: p.targetId as string },
        ),
      ];
    }
    // FollowRequestDeclined: DELIBERATELY unmapped — decline is silent (spec).
    case "ConnectionOffered": {
      // Only the new member hears about the offer. The inviter learns nothing until it is
      // accepted, and then only through the new_follower that the follow itself emits.
      return [
        cmd(
          p.toId as string,
          "connection_offer_received",
          p.offerId as string,
          await memberName(ctx, p.fromId as string),
          {
            actor: p.fromId as string,
            subject: { kind: "connectionOffer", offerId: p.offerId as string },
          },
        ),
      ];
    }

    // --- Household ---
    case "HouseholdInviteSent": {
      return [
        cmd(
          p.inviteeId as string,
          "household_invite_received",
          p.inviteId as string,
          await memberName(ctx, p.inviterId as string),
          {
            actor: p.inviterId as string,
            subject: {
              kind: "householdInvite",
              inviteId: p.inviteId as string,
            },
          },
        ),
      ];
    }
    case "HouseholdInviteAccepted": {
      return [
        cmd(
          p.inviterId as string,
          "household_invite_accepted",
          p.householdId as string,
          await memberName(ctx, p.inviteeId as string),
          {
            actor: p.inviteeId as string,
            subject: {
              kind: "household",
              householdId: p.householdId as string,
            },
          },
        ),
      ];
    }
    // HouseholdInviteDeclined: DELIBERATELY unmapped — decline is silent (spec).
    // A request to join tells the admin who minted the link (a dropped request records no event).
    case "HouseholdJoinRequested": {
      return [
        cmd(
          p.adminId as string,
          "household_join_request_received",
          p.requestId as string,
          await memberName(ctx, p.requesterId as string),
          {
            actor: p.requesterId as string,
            subject: {
              kind: "householdJoinRequest",
              requestId: p.requestId as string,
            },
          },
        ),
      ];
    }
    case "HouseholdJoinRequestApproved": {
      return [
        cmd(
          p.requesterId as string,
          "household_join_request_approved",
          p.householdId as string,
          await memberName(ctx, p.approverId as string),
          {
            actor: p.approverId as string,
            subject: {
              kind: "household",
              householdId: p.householdId as string,
            },
          },
        ),
      ];
    }
    // Declined, withdrawn and void requests: DELIBERATELY unmapped — silent (spec).

    // --- Sharing ---
    // Circle invite notifications carry no actorName snapshot: the actor is always a ref, and the
    // read side reveals them only by the ordinary public / mutual rule. Nothing is sent across a
    // block (either way) that landed before the event was dispatched.
    case "CircleInviteIssued": {
      const inviterId = p.inviterId as string;
      const inviteeId = p.inviteeId as string;
      if (
        await isBlockedEitherWay(ctx, asMember(inviteeId), asMember(inviterId))
      ) {
        return [];
      }
      return [
        cmd(
          inviteeId,
          "circle_invite_received",
          p.inviteId as string,
          {},
          {
            actor: inviterId,
            subject: { kind: "circleInvite", inviteId: p.inviteId as string },
          },
        ),
      ];
    }
    case "CircleInviteAccepted": {
      const inviterId = p.inviterId as string;
      const inviteeId = p.inviteeId as string;
      if (
        await isBlockedEitherWay(ctx, asMember(inviterId), asMember(inviteeId))
      ) {
        return [];
      }
      return [
        cmd(
          inviterId,
          "circle_invite_accepted",
          p.circleId as string,
          {},
          {
            actor: inviteeId,
            subject: { kind: "circle", circleId: p.circleId as string },
          },
        ),
      ];
    }
    // CircleInviteDeclined: DELIBERATELY unmapped — decline is silent to the inviter (spec).
    // CircleInviteRevoked / CircleInviteExpired: no member-facing notification.

    // Every member but the owner is told, neutrally: no actor (so there is nothing to filter on a
    // block), the circle's name snapshotted because the circle is gone, and a circle subject that
    // resolves as unavailable. Pending invitees are not told.
    case "CircleDeleted": {
      const circleId = p.circleId as string;
      return (p.memberIds as string[]).map((memberId) =>
        cmd(
          memberId,
          "circle_deleted",
          circleId,
          { circleName: p.circleName as string },
          { subject: { kind: "circle", circleId } },
        ),
      );
    }

    default:
      return [];
  }
};

// The exchange subject is the ExchangeId aggregateId the event carries (what exchange use cases
// take), not the row's Convex `_id` kept in relatedId.
const exchangeSubject = (p: Record<string, unknown>): NotificationSubject => ({
  kind: "exchange",
  exchangeId: p.exchangeId as string,
});

const puzzleSubject = (puzzle: Doc<"puzzles">): NotificationSubject => ({
  kind: "puzzle",
  puzzleId: puzzle._id,
});

// Build a NotifyMemberCommand. `recipient` is a user id (string or Convex Id); relatedId points at
// the upstream entity's Convex `_id` (opaque to Notifications); `params` carries the render-ready
// values for this type's copy (contract documented in notifications/copy.ts) — rendering happens at
// the edges (web i18n, email templates, push copy table), never here. `refs` adds the typed
// references the read side resolves live: the member who caused it (never set for moderator-driven
// outcomes, so a moderator is never exposed) and what it is about.
const cmd = (
  recipient: string | Id<"users">,
  type: NotifyMemberCommand["type"],
  relatedId: string,
  params: Record<string, string> = {},
  refs: { actor?: string | Id<"users">; subject?: NotificationSubject } = {},
): NotifyMemberCommand => ({
  memberId: asMember(recipient as string),
  type,
  params,
  relatedId,
  ...(refs.actor !== undefined
    ? { actorId: asMember(refs.actor as string) }
    : {}),
  ...(refs.subject !== undefined ? { subject: refs.subject } : {}),
});
