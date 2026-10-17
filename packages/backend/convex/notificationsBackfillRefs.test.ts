import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { BACKFILL_REFS_BATCH } from "./notifications/backfillRefs";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The refs backfill derives, for rows written before the subscriber stored refs, exactly the
// actorIds/actorCount/subject the subscriber would have written (spec 5.6), leaves anything it
// cannot derive with certainty absent, and touches nothing else on the row.

const T = 1_700_000_000_000; // the seeded notifications' createdAt

// Each batch logs its counts; keep the test output quiet.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type World = {
  alice: Id<"users">;
  bob: Id<"users">;
  carol: Id<"users">;
  puzzleId: Id<"puzzles">;
  copyId: Id<"ownedPuzzles">;
  exchangeId: Id<"exchanges">;
  legacyExchangeId: Id<"exchanges">;
  goalId: Id<"goals">;
};

const seedWorld = async (ctx: MutationCtx): Promise<World> => {
  const mkUser = (clerkId: string) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: T,
      updatedAt: T,
    });
  const alice = await mkUser("alice");
  const bob = await mkUser("bob");
  const carol = await mkUser("carol");
  const puzzleId = await ctx.db.insert("puzzles", {
    aggregateId: "puzzle-agg-1",
    title: "Starry Night",
    pieceCount: 1000,
    status: "approved",
    submittedBy: alice,
    createdAt: T,
    updatedAt: T,
  });
  const copyId = await ctx.db.insert("ownedPuzzles", {
    puzzleId,
    ownerId: bob,
    condition: "good",
    availability: { forTrade: false, forSale: true, forLend: false },
    createdAt: T,
    updatedAt: T,
  });
  const exchange = {
    initiatorId: alice,
    recipientId: bob,
    type: "sale" as const,
    requestedPuzzleId: copyId,
    status: "proposed" as const,
    createdAt: T,
    updatedAt: T,
  };
  const exchangeId = await ctx.db.insert("exchanges", {
    aggregateId: "exchange-agg-1",
    ...exchange,
  });
  // A legacy exchange predating aggregateIds: the actor is derivable, the subject is not.
  const legacyExchangeId = await ctx.db.insert("exchanges", exchange);
  await ctx.db.insert("threads", {
    aggregateId: "thread-2",
    subjectKind: "dm",
    participants: [alice, bob],
    participantsKey: [alice, bob].sort().join("|"),
    readReceipts: [],
    createdAt: T,
  });
  await ctx.db.insert("threads", {
    aggregateId: "thread-3",
    subjectKind: "dm",
    participants: [alice, bob, carol],
    participantsKey: [alice, bob, carol].sort().join("|"),
    readReceipts: [],
    createdAt: T,
  });
  await ctx.db.insert("reviews", {
    aggregateId: "review-agg-1",
    exchangeId,
    reviewerId: alice,
    revieweeId: bob,
    rating: 5,
    categories: { communication: 5, packaging: 5, condition: 5, timeliness: 5 },
    createdAt: T,
  });
  const goalId = await ctx.db.insert("goals", {
    userId: bob,
    title: "Ten puzzles",
    targetCompletions: 10,
    currentCompletions: 10,
    isActive: true,
    createdAt: T,
    updatedAt: T,
  });
  await ctx.db.insert("puzzleChangeProposals", {
    aggregateId: "proposal-agg-1",
    puzzleDefinitionId: "puzzle-agg-1",
    proposedBy: carol,
    status: "pending",
    changes: { title: "Starry Night II" },
    baseline: { title: "Starry Night" },
    createdAt: T,
    updatedAt: T,
  });
  // Two requests from carol to bob: one before the notification (the trigger), one after.
  await ctx.db.insert("followRequests", {
    aggregateId: "request-before",
    requesterId: carol,
    targetId: bob,
    status: "declined",
    createdAt: T - 60_000,
  });
  await ctx.db.insert("followRequests", {
    aggregateId: "request-after",
    requesterId: carol,
    targetId: bob,
    status: "pending",
    createdAt: T + 60_000,
  });
  await ctx.db.insert("households", {
    aggregateId: "household-1",
    createdAt: T,
  });
  await ctx.db.insert("householdInvites", {
    aggregateId: "invite-1",
    householdId: "household-1",
    inviterId: alice,
    inviteeId: bob,
    status: "pending",
    createdAt: T,
  });
  // Alice's accepted invites in household-1: carol accepted nearest to the notification.
  await ctx.db.insert("householdInvites", {
    aggregateId: "invite-far",
    householdId: "household-1",
    inviterId: alice,
    inviteeId: bob,
    status: "accepted",
    createdAt: T - 10 * 86_400_000,
    respondedAt: T - 9 * 86_400_000,
  });
  await ctx.db.insert("householdInvites", {
    aggregateId: "invite-near",
    householdId: "household-1",
    inviterId: alice,
    inviteeId: carol,
    status: "accepted",
    createdAt: T - 120_000,
    respondedAt: T - 1_000,
  });
  return {
    alice,
    bob,
    carol,
    puzzleId,
    copyId,
    exchangeId,
    legacyExchangeId,
    goalId,
  };
};

const PARAMS = { actorName: "Someone", puzzleTitle: "Starry Night" };

const insertRow = (
  ctx: MutationCtx,
  userId: Id<"users">,
  type: Doc<"notifications">["type"],
  relatedId: string | undefined,
  extra: Partial<Doc<"notifications">> = {},
) =>
  ctx.db.insert("notifications", {
    aggregateId: crypto.randomUUID(),
    userId,
    type,
    ...(relatedId !== undefined ? { relatedId } : {}),
    params: PARAMS,
    channel: "inApp",
    isRead: true,
    createdAt: T,
    ...extra,
  });

const setup = async (
  seedRows: (
    ctx: MutationCtx,
    w: World,
  ) => Promise<Record<string, Id<"notifications">>>,
) => {
  const t = convexTest(schema, modules);
  const { w, ids } = await t.run(async (ctx) => {
    const w = await seedWorld(ctx);
    return { w, ids: await seedRows(ctx, w) };
  });
  const run = (args: { dryRun?: boolean } = {}) =>
    t.mutation(internal.notifications.backfillRefs.backfillRefs, args);
  const rows = () =>
    t.run(async (ctx) => {
      const out: Record<string, Doc<"notifications">> = {};
      for (const [key, id] of Object.entries(ids)) {
        out[key] = (await ctx.db.get(id))!;
      }
      return out;
    });
  return { t, w, run, rows };
};

const refsOf = (row: Doc<"notifications">) => ({
  actorIds: row.actorIds,
  actorCount: row.actorCount,
  subject: row.subject,
});
const actor = (id: Id<"users">) => ({ actorIds: [id], actorCount: 1 });
const none = { actorIds: undefined, actorCount: undefined };
const noSubject = { subject: undefined };

describe("notifications/backfillRefs derivation per type", () => {
  test("exchange types: actor is the recipient's counterparty, subject the aggregateId", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      request: await insertRow(ctx, w.bob, "trade_request", w.exchangeId),
      accepted: await insertRow(ctx, w.alice, "trade_accepted", w.exchangeId),
      declined: await insertRow(ctx, w.alice, "trade_declined", w.exchangeId),
      cancelled: await insertRow(ctx, w.bob, "trade_cancelled", w.exchangeId),
      completedA: await insertRow(
        ctx,
        w.alice,
        "trade_completed",
        w.exchangeId,
      ),
      completedB: await insertRow(ctx, w.bob, "trade_completed", w.exchangeId),
      // Bob raised the dispute, so alice (his counterparty) is notified with bob as actor.
      disputed: await insertRow(
        ctx,
        w.alice,
        "exchange_disputed",
        w.exchangeId,
      ),
    }));
    await run();
    const r = await rows();
    const subject = { kind: "exchange", exchangeId: "exchange-agg-1" };
    expect(refsOf(r.request)).toEqual({ ...actor(w.alice), subject });
    expect(refsOf(r.accepted)).toEqual({ ...actor(w.bob), subject });
    expect(refsOf(r.declined)).toEqual({ ...actor(w.bob), subject });
    expect(refsOf(r.cancelled)).toEqual({ ...actor(w.alice), subject });
    expect(refsOf(r.completedA)).toEqual({ ...actor(w.bob), subject });
    expect(refsOf(r.completedB)).toEqual({ ...actor(w.alice), subject });
    expect(refsOf(r.disputed)).toEqual({ ...actor(w.bob), subject });
  });

  test("exchange types: legacy exchange gets an actor only; a non-party recipient gets nothing", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      legacy: await insertRow(ctx, w.bob, "trade_request", w.legacyExchangeId),
      outsider: await insertRow(ctx, w.carol, "trade_completed", w.exchangeId),
      bogus: await insertRow(ctx, w.bob, "trade_request", "not-an-id"),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.legacy)).toEqual({ ...actor(w.alice), ...noSubject });
    expect(refsOf(r.outsider)).toEqual({
      ...none,
      subject: { kind: "exchange", exchangeId: "exchange-agg-1" },
    });
    expect(refsOf(r.bogus)).toEqual({ ...none, ...noSubject });
  });

  test("message_received: actor only in a 2-participant thread", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      pair: await insertRow(ctx, w.bob, "message_received", "thread-2"),
      group: await insertRow(ctx, w.bob, "message_received", "thread-3"),
      missing: await insertRow(ctx, w.bob, "message_received", "thread-x"),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.pair)).toEqual({
      ...actor(w.alice),
      subject: { kind: "thread", threadId: "thread-2" },
    });
    expect(refsOf(r.group)).toEqual({
      ...none,
      subject: { kind: "thread", threadId: "thread-3" },
    });
    expect(refsOf(r.missing)).toEqual({ ...none, ...noSubject });
  });

  test("review_received: reviewer is the actor, only for the reviewee", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      review: await insertRow(ctx, w.bob, "review_received", "review-agg-1"),
      wrongRecipient: await insertRow(
        ctx,
        w.carol,
        "review_received",
        "review-agg-1",
      ),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.review)).toEqual({
      ...actor(w.alice),
      subject: { kind: "review", reviewId: "review-agg-1" },
    });
    expect(refsOf(r.wrongRecipient)).toEqual({ ...none, ...noSubject });
  });

  test("moderation outcomes, goal and photo: subject only, never an actor", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      approved: await insertRow(ctx, w.alice, "puzzle_approved", w.puzzleId),
      rejected: await insertRow(ctx, w.alice, "puzzle_rejected", w.puzzleId),
      pApproved: await insertRow(ctx, w.carol, "proposal_approved", w.puzzleId),
      pRejected: await insertRow(ctx, w.carol, "proposal_rejected", w.puzzleId),
      goal: await insertRow(ctx, w.bob, "goal_achieved", w.goalId),
      photo: await insertRow(ctx, w.bob, "photo_removed", w.copyId),
      // A relatedId of the wrong table is not a puzzle: left absent.
      wrongTable: await insertRow(ctx, w.alice, "puzzle_approved", w.copyId),
    }));
    await run();
    const r = await rows();
    const puzzle = { kind: "puzzle", puzzleId: w.puzzleId };
    expect(refsOf(r.approved)).toEqual({ ...none, subject: puzzle });
    expect(refsOf(r.rejected)).toEqual({ ...none, subject: puzzle });
    expect(refsOf(r.pApproved)).toEqual({ ...none, subject: puzzle });
    expect(refsOf(r.pRejected)).toEqual({ ...none, subject: puzzle });
    expect(refsOf(r.goal)).toEqual({
      ...none,
      subject: { kind: "goal", goalId: w.goalId },
    });
    expect(refsOf(r.photo)).toEqual({
      ...none,
      subject: { kind: "copy", copyId: w.copyId },
    });
    expect(refsOf(r.wrongTable)).toEqual({ ...none, ...noSubject });
  });

  test("admin rows: proposer / submitter is the actor", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      proposal: await insertRow(
        ctx,
        w.bob,
        "admin_proposal_filed",
        "proposal-agg-1",
      ),
      unknownProposal: await insertRow(
        ctx,
        w.bob,
        "admin_proposal_filed",
        "nope",
      ),
      definition: await insertRow(
        ctx,
        w.bob,
        "admin_definition_submitted",
        w.puzzleId,
      ),
      // The subscriber fell back to the aggregateId when the puzzle was unresolvable: no refs.
      unresolved: await insertRow(
        ctx,
        w.bob,
        "admin_definition_submitted",
        "puzzle-agg-1",
      ),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.proposal)).toEqual({
      ...actor(w.carol),
      subject: { kind: "changeProposal", proposalId: "proposal-agg-1" },
    });
    expect(refsOf(r.unknownProposal)).toEqual({ ...none, ...noSubject });
    expect(refsOf(r.definition)).toEqual({
      ...actor(w.alice),
      subject: { kind: "puzzle", puzzleId: w.puzzleId },
    });
    expect(refsOf(r.unresolved)).toEqual({ ...none, ...noSubject });
  });

  test("social: follower / approver / requester are the actor", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      follower: await insertRow(ctx, w.bob, "new_follower", w.carol),
      approved: await insertRow(ctx, w.carol, "follow_request_approved", w.bob),
      request: await insertRow(ctx, w.bob, "follow_request_received", w.carol),
      // No request from alice to bob exists: actor yes, subject absent.
      noRequest: await insertRow(
        ctx,
        w.bob,
        "follow_request_received",
        w.alice,
      ),
      bogus: await insertRow(ctx, w.bob, "new_follower", "not-a-user"),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.follower)).toEqual({ ...actor(w.carol), ...noSubject });
    expect(refsOf(r.approved)).toEqual({ ...actor(w.bob), ...noSubject });
    expect(refsOf(r.request)).toEqual({
      ...actor(w.carol),
      subject: { kind: "followRequest", requestId: "request-before" },
    });
    expect(refsOf(r.noRequest)).toEqual({ ...actor(w.alice), ...noSubject });
    expect(refsOf(r.bogus)).toEqual({ ...none, ...noSubject });
  });

  test("household: inviter for received; nearest accepted invitee for accepted", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      received: await insertRow(
        ctx,
        w.bob,
        "household_invite_received",
        "invite-1",
      ),
      wrongInvitee: await insertRow(
        ctx,
        w.carol,
        "household_invite_received",
        "invite-1",
      ),
      accepted: await insertRow(
        ctx,
        w.alice,
        "household_invite_accepted",
        "household-1",
      ),
      // Bob invited nobody into household-1: subject only, no actor.
      noInvite: await insertRow(
        ctx,
        w.bob,
        "household_invite_accepted",
        "household-1",
      ),
      unknown: await insertRow(
        ctx,
        w.alice,
        "household_invite_accepted",
        "hh-x",
      ),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.received)).toEqual({
      ...actor(w.alice),
      subject: { kind: "householdInvite", inviteId: "invite-1" },
    });
    expect(refsOf(r.wrongInvitee)).toEqual({ ...none, ...noSubject });
    const household = { kind: "household", householdId: "household-1" };
    expect(refsOf(r.accepted)).toEqual({
      ...actor(w.carol),
      subject: household,
    });
    expect(refsOf(r.noInvite)).toEqual({ ...none, subject: household });
    expect(refsOf(r.unknown)).toEqual({ ...none, ...noSubject });
  });

  test("whats_new gets its entry subject; dead types and rows without relatedId stay bare", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      whatsNew: await insertRow(ctx, w.bob, "whats_new", "2026-10-entry"),
      proposed: await insertRow(ctx, w.bob, "exchange_proposed", w.exchangeId),
      favorited: await insertRow(ctx, w.bob, "puzzle_favorited", w.puzzleId),
      legacy: await insertRow(ctx, w.bob, "trade_request", undefined, {
        title: "Trade request",
        message: "Someone wants to trade",
        params: undefined,
      }),
    }));
    await run();
    const r = await rows();
    expect(refsOf(r.whatsNew)).toEqual({
      ...none,
      subject: { kind: "whatsNew", entryId: "2026-10-entry" },
    });
    expect(refsOf(r.proposed)).toEqual({ ...none, ...noSubject });
    expect(refsOf(r.favorited)).toEqual({ ...none, ...noSubject });
    expect(refsOf(r.legacy)).toEqual({ ...none, ...noSubject });
  });
});

describe("notifications/backfillRefs safety", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("never touches isRead/createdAt/params/type and only adds ref fields", async () => {
    const { w, run, rows, t } = await setup(async (ctx, w) => ({
      unread: await insertRow(ctx, w.bob, "new_follower", w.carol, {
        isRead: false,
        createdAt: T - 5,
      }),
    }));
    const before = await t.run(async (ctx) => {
      const docs = await ctx.db.query("notifications").collect();
      return docs[0];
    });
    await run();
    const after = (await rows()).unread;
    expect(after).toEqual({ ...before, ...actor(w.carol) });
    expect(after.isRead).toBe(false);
    expect(after.createdAt).toBe(T - 5);
    expect(after.params).toEqual(PARAMS);
    expect(after.type).toBe("new_follower");
  });

  test("rows that already carry refs are left untouched", async () => {
    const { w, run, rows } = await setup(async (ctx, w) => ({
      hasActor: await insertRow(ctx, w.bob, "trade_request", w.exchangeId, {
        actorIds: [w.carol],
        actorCount: 1,
      }),
      hasSubject: await insertRow(ctx, w.bob, "new_follower", w.carol, {
        subject: { kind: "whatsNew", entryId: "keep-me" },
      }),
    }));
    const result = await run();
    expect(result).toEqual({ scanned: 2, patched: 0, skipped: 2 });
    const r = await rows();
    expect(refsOf(r.hasActor)).toEqual({ ...actor(w.carol), ...noSubject });
    expect(refsOf(r.hasSubject)).toEqual({
      ...none,
      subject: { kind: "whatsNew", entryId: "keep-me" },
    });
  });

  test("idempotent: a second run patches nothing", async () => {
    const { w, run } = await setup(async (ctx, w) => ({
      a: await insertRow(ctx, w.bob, "new_follower", w.carol),
      b: await insertRow(ctx, w.bob, "trade_request", w.exchangeId),
      c: await insertRow(ctx, w.bob, "puzzle_favorited", w.puzzleId),
    }));
    expect(await run()).toEqual({ scanned: 3, patched: 2, skipped: 1 });
    expect(await run()).toEqual({ scanned: 3, patched: 0, skipped: 3 });
  });

  test("dryRun counts what it would patch and writes nothing", async () => {
    const { w, run, t } = await setup(async (ctx, w) => ({
      a: await insertRow(ctx, w.bob, "new_follower", w.carol),
      b: await insertRow(ctx, w.bob, "puzzle_favorited", w.puzzleId),
    }));
    const snapshot = () =>
      t.run((ctx) => ctx.db.query("notifications").collect());
    const before = await snapshot();
    expect(await run({ dryRun: true })).toEqual({
      scanned: 2,
      patched: 1,
      skipped: 1,
    });
    expect(await snapshot()).toEqual(before);
  });

  test("multi-page: reschedules itself until every row is backfilled", async () => {
    vi.useFakeTimers();
    const total = BACKFILL_REFS_BATCH * 2 + 5;
    const { t, w, run } = await setup(async (ctx, w) => {
      for (let i = 0; i < total; i++) {
        await insertRow(ctx, w.bob, "new_follower", w.carol);
      }
      return {};
    });
    const first = await run();
    expect(first).toEqual({
      scanned: BACKFILL_REFS_BATCH,
      patched: BACKFILL_REFS_BATCH,
      skipped: 0,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const docs = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(docs).toHaveLength(total);
    expect(docs.every((d) => d.actorIds?.[0] === w.carol)).toBe(true);
  });

  test("multi-page dry run walks every page without writing", async () => {
    vi.useFakeTimers();
    const total = BACKFILL_REFS_BATCH + 3;
    const { t, w, run } = await setup(async (ctx, w) => {
      for (let i = 0; i < total; i++) {
        await insertRow(ctx, w.bob, "new_follower", w.carol);
      }
      return {};
    });
    await run({ dryRun: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const docs = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(docs.some((d) => d.actorIds !== undefined)).toBe(false);
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args[0]).toMatchObject({
      dryRun: true,
      totals: { scanned: BACKFILL_REFS_BATCH, patched: BACKFILL_REFS_BATCH },
    });
  });
});
