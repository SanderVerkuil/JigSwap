import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The subscriber writes typed refs onto every in-app row: who caused it (actorIds/actorCount) and
// what it is about (subject). Moderator-driven outcomes never carry an actor. Each test seeds the
// minimal upstream rows, records one event and runs the subscriber on it directly.

type World = {
  alice: Id<"users">;
  bob: Id<"users">;
  admin: Id<"users">;
  puzzleId: Id<"puzzles">;
  copyId: Id<"ownedPuzzles">;
};

const seedWorld = async (ctx: MutationCtx): Promise<World> => {
  const now = Date.now();
  const mkUser = (clerkId: string, role?: string) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      ...(role ? { role } : {}),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  const alice = await mkUser("alice");
  const bob = await mkUser("bob");
  const admin = await mkUser("admin", "admin");
  const puzzleId = await ctx.db.insert("puzzles", {
    aggregateId: "puzzle-agg-1",
    title: "Starry Night",
    pieceCount: 1000,
    status: "approved",
    submittedBy: alice,
    createdAt: now,
    updatedAt: now,
  });
  const copyId = await ctx.db.insert("ownedPuzzles", {
    puzzleId,
    ownerId: bob,
    condition: "good",
    availability: { forTrade: false, forSale: true, forLend: false },
    createdAt: now,
    updatedAt: now,
  });
  return { alice, bob, admin, puzzleId, copyId };
};

// Alice (initiator) proposed a sale to Bob (recipient).
const seedExchange = (ctx: MutationCtx, w: World) =>
  ctx.db.insert("exchanges", {
    aggregateId: "exchange-agg-1",
    initiatorId: w.alice,
    recipientId: w.bob,
    type: "sale",
    requestedPuzzleId: w.copyId,
    status: "proposed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

const dispatch = async (
  ctx: MutationCtx,
  name: string,
  payload: Record<string, unknown>,
) => {
  const eventId = await ctx.db.insert("domainEvents", {
    name,
    payload,
    occurredAt: Date.now(),
    context: "test",
  });
  await handleDomainEvent(
    ctx,
    (await ctx.db.get(eventId)) as Doc<"domainEvents">,
  );
};

const rowsFor = (ctx: MutationCtx, userId: Id<"users">) =>
  ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

// Run a scenario and return the single in-app row of `type` for the chosen recipient.
const onlyRow = async (
  scenario: (
    ctx: MutationCtx,
    w: World,
  ) => Promise<{ recipient: Id<"users">; type: Doc<"notifications">["type"] }>,
) => {
  const t = convexTest(schema, modules);
  return t.run(async (ctx) => {
    const w = await seedWorld(ctx);
    const { recipient, type } = await scenario(ctx, w);
    const rows = (await rowsFor(ctx, recipient)).filter((r) => r.type === type);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe("inApp");
    return { row: rows[0] as Doc<"notifications">, w };
  });
};

const exchangeSubject = { kind: "exchange", exchangeId: "exchange-agg-1" };

describe("subscriber refs: exchange", () => {
  test("trade_request: the initiator is the actor", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await seedExchange(ctx, w);
      await dispatch(ctx, "ExchangeProposed", { exchangeId: "exchange-agg-1" });
      return { recipient: w.bob, type: "trade_request" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.actorCount).toBe(1);
    expect(row.subject).toEqual(exchangeSubject);
    // The name snapshot stays for email/push.
    expect(row.params).toEqual({ actorName: "alice" });
  });

  test.each([
    ["ExchangeAccepted", "trade_accepted"],
    ["ExchangeRejected", "trade_declined"],
  ] as const)("%s: the recipient is the actor", async (event, type) => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await seedExchange(ctx, w);
      await dispatch(ctx, event, { exchangeId: "exchange-agg-1" });
      return { recipient: w.alice, type };
    });
    expect(row.actorIds).toEqual([w.bob]);
    expect(row.subject).toEqual(exchangeSubject);
  });

  test("trade_cancelled: the initiator is the actor", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await seedExchange(ctx, w);
      await dispatch(ctx, "ExchangeCancelled", {
        exchangeId: "exchange-agg-1",
      });
      return { recipient: w.bob, type: "trade_cancelled" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual(exchangeSubject);
  });

  test("trade_completed: each party gets the other party as the actor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const w = await seedWorld(ctx);
      await seedExchange(ctx, w);
      await dispatch(ctx, "ExchangeCompleted", {
        exchangeId: "exchange-agg-1",
      });
      const [forAlice] = await rowsFor(ctx, w.alice);
      const [forBob] = await rowsFor(ctx, w.bob);
      expect(forAlice?.actorIds).toEqual([w.bob]);
      expect(forBob?.actorIds).toEqual([w.alice]);
      expect(forAlice?.subject).toEqual(exchangeSubject);
      expect(forBob?.subject).toEqual(exchangeSubject);
    });
  });

  test("exchange_disputed: the member who raised it is the actor", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await seedExchange(ctx, w);
      await dispatch(ctx, "DisputeRaised", {
        exchangeId: "exchange-agg-1",
        raisedBy: w.bob,
      });
      return { recipient: w.alice, type: "exchange_disputed" };
    });
    expect(row.actorIds).toEqual([w.bob]);
    expect(row.subject).toEqual(exchangeSubject);
  });
});

describe("subscriber refs: conversation, solving, reputation", () => {
  test("message_received: the author is the actor, the thread the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await ctx.db.insert("threads", {
        aggregateId: "thread-agg-1",
        subjectKind: "dm",
        participants: [w.alice, w.bob],
        participantsKey: [w.alice, w.bob].sort().join("|"),
        readReceipts: [],
        createdAt: Date.now(),
      });
      await dispatch(ctx, "MessagePosted", {
        threadId: "thread-agg-1",
        authorId: w.alice,
      });
      return { recipient: w.bob, type: "message_received" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({ kind: "thread", threadId: "thread-agg-1" });
  });

  test("goal_achieved: no actor, the goal is the subject", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const w = await seedWorld(ctx);
      const goalId = await ctx.db.insert("goals", {
        aggregateId: "goal-agg-1",
        userId: w.alice,
        title: "Ten puzzles",
        targetCompletions: 10,
        currentCompletions: 10,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await dispatch(ctx, "GoalAchieved", { goalId: "goal-agg-1" });
      const [row] = await rowsFor(ctx, w.alice);
      expect(row?.type).toBe("goal_achieved");
      expect(row?.actorIds).toBeUndefined();
      expect(row?.actorCount).toBeUndefined();
      expect(row?.subject).toEqual({ kind: "goal", goalId });
    });
  });

  test("review_received: the reviewer is the actor, the rating is snapshotted", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "PartnerReviewSubmitted", {
        reviewId: "review-agg-1",
        exchangeId: "exchange-agg-1",
        reviewerId: w.alice,
        revieweeId: w.bob,
        rating: 4,
      });
      return { recipient: w.bob, type: "review_received" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({ kind: "review", reviewId: "review-agg-1" });
    expect(row.params).toEqual({ rating: "4" });
  });
});

describe("subscriber refs: catalog moderation outcomes never expose the moderator", () => {
  test.each([
    ["PuzzleDefinitionApproved", "puzzle_approved", {}],
    ["PuzzleDefinitionRejected", "puzzle_rejected", {}],
    ["ChangeProposalApproved", "proposal_approved", { proposedBy: "alice" }],
    [
      "ChangeProposalRejected",
      "proposal_rejected",
      { proposedBy: "alice", reason: "dupe" },
    ],
  ] as const)(
    "%s: no actor, the puzzle is the subject",
    async (event, type, extra) => {
      const { row, w } = await onlyRow(async (ctx, w) => {
        await dispatch(ctx, event, {
          puzzleDefinitionId: "puzzle-agg-1",
          ...("proposedBy" in extra ? { ...extra, proposedBy: w.alice } : {}),
        });
        return { recipient: w.alice, type };
      });
      expect(row.actorIds).toBeUndefined();
      expect(row.actorCount).toBeUndefined();
      expect(row.subject).toEqual({ kind: "puzzle", puzzleId: w.puzzleId });
    },
  );
});

describe("subscriber refs: admin review queue", () => {
  test("admin_proposal_filed: the proposer is the actor, the proposal the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "ChangeProposalFiled", {
        changeProposalId: "proposal-agg-1",
        puzzleDefinitionId: "puzzle-agg-1",
        proposedBy: w.alice,
      });
      return { recipient: w.admin, type: "admin_proposal_filed" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({
      kind: "changeProposal",
      proposalId: "proposal-agg-1",
    });
  });

  test("admin_definition_submitted: the submitter is the actor, the puzzle the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "PuzzleDefinitionSubmitted", {
        puzzleDefinitionId: "puzzle-agg-1",
        submittedBy: w.alice,
      });
      return { recipient: w.admin, type: "admin_definition_submitted" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({ kind: "puzzle", puzzleId: w.puzzleId });
  });

  test("admin_definition_submitted for an unresolvable puzzle keeps the actor, drops the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "PuzzleDefinitionSubmitted", {
        puzzleDefinitionId: "puzzle-agg-missing",
        submittedBy: w.alice,
      });
      return { recipient: w.admin, type: "admin_definition_submitted" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toBeUndefined();
    expect(row.relatedId).toBe("puzzle-agg-missing");
  });
});

describe("subscriber refs: social and household", () => {
  test("new_follower: the follower is the actor, no subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "MemberFollowed", {
        followerId: w.alice,
        followeeId: w.bob,
      });
      return { recipient: w.bob, type: "new_follower" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.actorCount).toBe(1);
    expect(row.subject).toBeUndefined();
  });

  test("follow_request_received: the requester is the actor, the request the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "FollowRequested", {
        requestId: "follow-request-agg-1",
        requesterId: w.alice,
        targetId: w.bob,
      });
      return { recipient: w.bob, type: "follow_request_received" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({
      kind: "followRequest",
      requestId: "follow-request-agg-1",
    });
  });

  test("follow_request_approved: the target is the actor, no subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "FollowRequestApproved", {
        requestId: "follow-request-agg-1",
        requesterId: w.alice,
        targetId: w.bob,
      });
      return { recipient: w.alice, type: "follow_request_approved" };
    });
    expect(row.actorIds).toEqual([w.bob]);
    expect(row.subject).toBeUndefined();
  });

  test("household_invite_received: the inviter is the actor, the invite the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "HouseholdInviteSent", {
        inviteId: "invite-agg-1",
        householdId: "household-agg-1",
        inviterId: w.alice,
        inviteeId: w.bob,
      });
      return { recipient: w.bob, type: "household_invite_received" };
    });
    expect(row.actorIds).toEqual([w.alice]);
    expect(row.subject).toEqual({
      kind: "householdInvite",
      inviteId: "invite-agg-1",
    });
  });

  test("household_invite_accepted: the invitee is the actor, the household the subject", async () => {
    const { row, w } = await onlyRow(async (ctx, w) => {
      await dispatch(ctx, "HouseholdInviteAccepted", {
        inviteId: "invite-agg-1",
        householdId: "household-agg-1",
        inviterId: w.alice,
        inviteeId: w.bob,
      });
      return { recipient: w.alice, type: "household_invite_accepted" };
    });
    expect(row.actorIds).toEqual([w.bob]);
    expect(row.subject).toEqual({
      kind: "household",
      householdId: "household-agg-1",
    });
  });
});
