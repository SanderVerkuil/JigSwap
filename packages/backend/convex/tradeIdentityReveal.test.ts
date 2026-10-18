import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { projectMemberIdentity } from "./social/privacy";

// Per-trade identity reveal. Inside ONE exchange: the owner always sees the requester; the
// requester sees the owner once the owner acted on THAT exchange (accepted, or posted a
// member-authored message in its thread — a `tradeReveals` row). A trade reveal exposes a LIMITED
// view (name/handle, no avatar/bio/location) and never unlocks the member's profile, collection or
// identity anywhere else. Both parties have PRIVATE profiles unless a test says otherwise.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

// The dispatcher runs via runAfter(0); yield a macrotask then drain, a few times to settle chains.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

type World = {
  requester: Id<"users">;
  owner: Id<"users">;
  third: Id<"users">;
  copy: Id<"ownedPuzzles">;
  copy2: Id<"ownedPuzzles">;
  thirdCopy: Id<"ownedPuzzles">;
  puzzleId: Id<"puzzles">;
};

const setVisibility = (
  t: T,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique();
    if (row) await ctx.db.patch(row._id, { visibility });
    else
      await ctx.db.insert("profiles", {
        aggregateId: `prof-${memberId}`,
        memberId,
        displayName: "X",
        visibility,
        updatedAt: 1,
      });
  });

const seed = async (t: T): Promise<World> => {
  const world = await t.run(async (ctx) => {
    const now = 1_000_000;
    const mkUser = (who: string, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name,
        username: who,
        avatar: `https://avatars/${who}.png`,
        bio: `${who} bio`,
        location: `${who} town`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const requester = await mkUser("requester", "Rita Requester");
    const owner = await mkUser("owner", "Olivia Owner");
    const third = await mkUser("third", "Theo Third");
    // The catalog definition is submitted by the third member so it carries no party's id.
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: third,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    return {
      requester,
      owner,
      third,
      puzzleId,
      copy: await mkCopy(owner),
      copy2: await mkCopy(owner),
      thirdCopy: await mkCopy(third),
    };
  });
  for (const id of [world.requester, world.owner, world.third]) {
    await setVisibility(t, id, "private");
  }
  return world;
};

const propose = async (
  t: T,
  who: string,
  requestedPuzzleId: Id<"ownedPuzzles">,
  recipientId?: Id<"users">,
): Promise<string> => {
  const id = await as(t, who).mutation(api.exchange.propose.propose, {
    ...(recipientId ? { recipientId } : {}),
    // A sale needs no offered copy, keeping the fixtures small; the reveal is kind-agnostic.
    type: "sale",
    salePrice: 10,
    requestedPuzzleId,
  });
  await flush(t);
  return id;
};

const act = async (
  t: T,
  who: string,
  action: "accept" | "decline" | "cancel" | "confirmCompletion",
  exchangeId: string,
) => {
  const fn = {
    accept: api.exchange.accept.accept,
    decline: api.exchange.decline.decline,
    cancel: api.exchange.cancel.cancel,
    confirmCompletion: api.exchange.confirmCompletion.confirmCompletion,
  }[action];
  await as(t, who).mutation(fn, { exchangeId });
  await flush(t);
};

const postInThread = async (
  t: T,
  who: string,
  exchangeId: string,
  body = "hello",
) => {
  const threadId = await as(t, who).query(
    api.conversation.getThreadByExchange.getThreadByExchange,
    { exchangeId },
  );
  expect(threadId).not.toBeNull();
  await as(t, who).mutation(api.conversation.postMessage.postMessage, {
    threadId: threadId!,
    kind: "text",
    body,
  });
  await flush(t);
};

const docIdOf = (t: T, aggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    return row!._id;
  });

const tradeReveals = (t: T) =>
  t.run(async (ctx) => ctx.db.query("tradeReveals").collect());

/** The single-exchange detail view as `who` sees it. */
const detail = async (t: T, who: string, exchangeId: string) =>
  as(t, who).query(api.exchange.getExchangeById.getExchangeById, {
    exchangeId: await docIdOf(t, exchangeId),
  });

const exchangeViews = async (t: T, who: string, exchangeId: string) => {
  const reader = as(t, who);
  return {
    detail: await detail(t, who, exchangeId),
    list: await reader.query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    ),
    asRequester: await reader.query(
      api.exchange.getExchangesByRequester.getExchangesByRequester,
      {},
    ),
    asOwner: await reader.query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    ),
  };
};

const notificationViews = async (t: T, who: string) =>
  (
    await as(t, who).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 50, cursor: null } },
    )
  ).page;

const notificationOf = async (t: T, who: string, type: string) =>
  (await notificationViews(t, who)).find((n) => n.type === type);

/** The ordinary (non-trade) identity projection, e.g. a copy's history. */
const seesElsewhere = (t: T, viewer: Id<"users">, target: Id<"users">) =>
  t.run(
    async (ctx) =>
      !(await projectMemberIdentity(ctx, viewer, target, "salt")).anonymous,
  );

const TRIMMED_KEYS = [
  "_creationTime",
  "_id",
  "createdAt",
  "isActive",
  "name",
  "updatedAt",
  "username",
];

describe("per-trade reveal: the owner sees the requester", () => {
  test("right after propose, in every exchange view, trimmed", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);

    const views = await exchangeViews(t, "owner", ex);

    expect(views.detail?.requesterState).toBe("tradeRevealed");
    expect(views.detail?.ownerState).toBe("visible");
    expect(Object.keys(views.detail!.requester!).sort()).toEqual(TRIMMED_KEYS);
    expect(views.detail?.requester?.name).toBe("Rita Requester");
    expect(views.detail?.initiatorId).toBe(w.requester);
    expect(views.asOwner[0]!.requester?._id).toBe(w.requester);
    expect(views.asOwner[0]!.requesterState).toBe("tradeRevealed");
    expect(views.list[0]!.requester?.username).toBe("requester");
    const json = JSON.stringify(views);
    for (const leak of [
      "avatars/requester",
      "requester bio",
      "requester town",
    ]) {
      expect(json).not.toContain(leak);
    }
    // No row is needed for this direction.
    expect(await tradeReveals(t)).toHaveLength(0);
  });

  test("the trade request notification names the requester, without avatar", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await propose(t, "requester", w.copy);

    const request = await notificationOf(t, "owner", "trade_request");
    expect(request?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.requester,
      tradeRevealed: true,
    });
    expect(request?.actors[0]).not.toHaveProperty("avatar");
  });

  test("but NOT the requester's private profile or identity anywhere else", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("completions", {
        userId: w.requester,
        puzzleId: w.puzzleId,
        startDate: 1,
        isCompleted: true,
        completionTimeMinutes: 90,
        photos: [],
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await propose(t, "requester", w.copy);
    const asOwner = as(t, "owner");

    expect(
      (
        await asOwner.query(api.social.getPublicProfile.getPublicProfile, {
          handle: "requester",
        })
      )?.locked,
    ).toBe(true);
    const page = { numItems: 10, cursor: null };
    expect(
      (
        await asOwner.query(
          api.social.listProfileCompletions.listProfileCompletions,
          { memberId: w.requester, paginationOpts: page },
        )
      ).page,
    ).toHaveLength(0);
    expect(
      (
        await asOwner.query(api.social.listProfileCopies.listProfileCopies, {
          memberId: w.requester,
          paginationOpts: page,
        })
      ).page,
    ).toHaveLength(0);
    expect(
      await asOwner.query(api.identity.getUserById.getUserById, {
        userId: w.requester,
      }),
    ).toBeNull();
    expect(
      await asOwner.query(api.social.getProfile.getProfile, {
        memberId: w.requester,
      }),
    ).toBeNull();
    expect(await seesElsewhere(t, w.owner, w.requester)).toBe(false);
  });
});

describe("per-trade reveal: the requester sees the owner only after the owner acts", () => {
  test("hidden right after propose, with no raw owner id anywhere", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);

    const views = await exchangeViews(t, "requester", ex);

    expect(views.detail?.owner).toBeNull();
    expect(views.detail?.ownerState).toBe("hidden");
    expect(views.detail?.requesterState).toBe("visible");
    expect(views.detail?.requester?._id).toBe(w.requester);
    expect(views.detail).not.toHaveProperty("recipientId");
    expect(views.detail?.ownerPuzzle).not.toHaveProperty("ownerId");
    expect(views.list[0]!.owner).toBeNull();
    expect(views.asRequester[0]!.ownerState).toBe("hidden");
    const json = JSON.stringify(views);
    expect(json).not.toContain(w.owner);
    expect(json).not.toContain("Olivia");
  });

  test("accepting reveals the owner inside this trade, trimmed", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);

    const view = await detail(t, "requester", ex);
    expect(view?.ownerState).toBe("tradeRevealed");
    expect(Object.keys(view!.owner!).sort()).toEqual(TRIMMED_KEYS);
    expect(view?.recipientId).toBe(w.owner);
    expect(view?.ownerPuzzle?.ownerId).toBe(w.owner);
    expect(await tradeReveals(t)).toMatchObject([{ reason: "accepted" }]);
    const accepted = await notificationOf(t, "requester", "trade_accepted");
    expect(accepted?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.owner,
      tradeRevealed: true,
    });
  });

  test("an owner-authored thread message reveals the owner without accepting", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await postInThread(t, "owner", ex, "Which edition is yours?");

    expect((await detail(t, "requester", ex))?.ownerState).toBe(
      "tradeRevealed",
    );
    expect(await tradeReveals(t)).toMatchObject([{ reason: "owner_replied" }]);
  });

  test("the requester's own messages and the lifecycle system messages never reveal the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await postInThread(t, "requester", ex, "Still interested?");

    expect((await detail(t, "requester", ex))?.ownerState).toBe("hidden");
    expect(await tradeReveals(t)).toHaveLength(0);
  });

  test("the reveal stays inside that trade: a second trade, the profile and elsewhere stay hidden", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const first = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", first);
    const second = await propose(t, "requester", w.copy2);

    expect((await detail(t, "requester", first))?.ownerState).toBe(
      "tradeRevealed",
    );
    const other = await detail(t, "requester", second);
    expect(other?.ownerState).toBe("hidden");
    expect(JSON.stringify(other)).not.toContain(w.owner);
    expect(await seesElsewhere(t, w.requester, w.owner)).toBe(false);
    expect(
      (
        await as(t, "requester").query(
          api.social.getPublicProfile.getPublicProfile,
          { handle: "owner" },
        )
      )?.locked,
    ).toBe(true);
  });

  test("declining before any reply keeps the owner hidden, also in the notification", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "decline", ex);

    expect((await detail(t, "requester", ex))?.ownerState).toBe("hidden");
    const decline = await notificationOf(t, "requester", "trade_declined");
    expect(decline?.actors).toEqual([{ anonymous: true }]);
    expect(
      JSON.stringify(await notificationViews(t, "requester")),
    ).not.toContain(w.owner);
  });

  test("a decline after the owner replied names the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await postInThread(t, "owner", ex, "Sorry, it's promised to a friend");
    await act(t, "owner", "decline", ex);

    const decline = await notificationOf(t, "requester", "trade_declined");
    expect(decline?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.owner,
      tradeRevealed: true,
    });
  });
});

describe("per-trade reveal: persistence and scope", () => {
  test("reveals persist after completion", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);
    await act(t, "owner", "confirmCompletion", ex);
    await act(t, "requester", "confirmCompletion", ex);

    const view = await detail(t, "requester", ex);
    expect(view?.status).toBe("completed");
    expect(view?.ownerState).toBe("tradeRevealed");
    expect((await detail(t, "owner", ex))?.requesterState).toBe(
      "tradeRevealed",
    );
  });

  test("reveals persist after cancelling an accepted exchange", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);
    await act(t, "requester", "cancel", ex);

    expect((await detail(t, "requester", ex))?.ownerState).toBe(
      "tradeRevealed",
    );
  });

  test("reveals persist after cancelling a proposal the owner replied to", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await postInThread(t, "owner", ex);
    await act(t, "requester", "cancel", ex);

    expect((await detail(t, "requester", ex))?.ownerState).toBe(
      "tradeRevealed",
    );
  });

  test("a third party is unaffected", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);

    expect(await detail(t, "third", ex)).toBeNull();
    for (const [a, b] of [
      [w.third, w.owner],
      [w.third, w.requester],
      [w.owner, w.third],
      [w.requester, w.third],
    ] as const) {
      expect(await seesElsewhere(t, a, b)).toBe(false);
    }
  });

  test("a public owner is visible (full view) to the requester without any reveal", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.owner, "public");
    const ex = await propose(t, "requester", w.copy);

    const view = await detail(t, "requester", ex);
    expect(view?.ownerState).toBe("visible");
    expect(view?.owner?.avatar).toBe("https://avatars/owner.png");
    expect(view?.recipientId).toBe(w.owner);
  });

  test("mutual followers stay visible as before", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await t.run(async (ctx) => {
      for (const [a, b] of [
        [w.requester, w.owner],
        [w.owner, w.requester],
      ] as const) {
        await ctx.db.insert("follows", {
          followerId: a,
          followeeId: b,
          createdAt: 1,
        });
      }
    });
    const ex = await propose(t, "requester", w.copy);

    expect((await detail(t, "requester", ex))?.ownerState).toBe("visible");
    expect((await detail(t, "owner", ex))?.requesterState).toBe("visible");
  });

  test("a departed counterparty reads as departed in views and notifications", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await t.run((ctx) => ctx.db.patch(w.requester, { isActive: false }));

    const view = await detail(t, "owner", ex);
    expect(view?.requesterState).toBe("departed");
    expect(view?.requester).toBeNull();
    const request = await notificationOf(t, "owner", "trade_request");
    expect(request?.actors).toEqual([{ anonymous: true, departed: true }]);
  });
});

describe("proposing never works as an ownership oracle", () => {
  test("propose without a recipientId uses the copy's owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    const docId = await docIdOf(t, ex);
    const row = await t.run(async (ctx) => ctx.db.get(docId));
    expect(row?.recipientId).toBe(w.owner);
    expect(row?.initiatorId).toBe(w.requester);
  });

  // The supplied recipientId is ignored, so a wrong and a right guess are indistinguishable.
  test("a wrong and a right recipientId both succeed with the copy owner as recipient", async () => {
    for (const guess of ["owner", "third"] as const) {
      const t = convexTest(schema, modules);
      const w = await seed(t);
      const ex = await propose(t, "requester", w.copy, w[guess]);
      const docId = await docIdOf(t, ex);
      const row = await t.run(async (ctx) => ctx.db.get(docId));
      expect(row?.recipientId).toBe(w.owner);
    }
  });

  test("a wrong and a right recipientId fail with the same error", async () => {
    const codes: string[] = [];
    for (const guess of ["owner", "third"] as const) {
      const t = convexTest(schema, modules);
      const w = await seed(t);
      // A swap of a sale-only copy fails the same way whoever the caller names.
      const error = await as(t, "requester")
        .mutation(api.exchange.propose.propose, {
          recipientId: w[guess],
          type: "trade",
          requestedPuzzleId: w.copy,
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const data = (error as { data?: unknown }).data;
      codes.push(typeof data === "string" ? data : JSON.stringify(data));
    }
    expect(codes[0]).toContain("CopyNotAvailable");
    expect(codes[1]).toBe(codes[0]);
  });
});

describe("getRequestDisclosure", () => {
  const disclosure = (
    t: T,
    who: string,
    requestedPuzzleId: Id<"ownedPuzzles">,
  ) =>
    as(t, who).query(api.exchange.getRequestDisclosure.getRequestDisclosure, {
      requestedPuzzleId,
    });

  // A private owner's copy is only viewable to the requester through canViewCopy's other paths;
  // the requester holding it is the smallest fixture that keeps the owner private.
  const seedViewable = async (t: T) => {
    const w = await seed(t);
    await t.run((ctx) => ctx.db.patch(w.copy, { heldBy: w.requester }));
    return w;
  };

  test("profilePrivate true for a private requester", async () => {
    const t = convexTest(schema, modules);
    const w = await seedViewable(t);
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      profilePrivate: true,
    });
  });

  test("profilePrivate false for a public requester", async () => {
    const t = convexTest(schema, modules);
    const w = await seedViewable(t);
    await setVisibility(t, w.requester, "public");
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      profilePrivate: false,
    });
  });

  test("null when the caller can't view the copy (same as a missing copy)", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    expect(await disclosure(t, "requester", w.copy)).toBeNull();
  });

  test("null for the owner's own copy, a missing copy, or a signed-out caller", async () => {
    const t = convexTest(schema, modules);
    const w = await seedViewable(t);
    expect(await disclosure(t, "owner", w.copy)).toBeNull();
    expect(
      await t.query(api.exchange.getRequestDisclosure.getRequestDisclosure, {
        requestedPuzzleId: w.copy,
      }),
    ).toBeNull();
    await t.run((ctx) => ctx.db.delete(w.thirdCopy));
    expect(await disclosure(t, "requester", w.thirdCopy)).toBeNull();
  });
});

describe("backfillTradeReveals", () => {
  type Case = {
    status: "proposed" | "accepted" | "rejected" | "cancelled";
    thread?: { author: "owner" | "requester" | null; body: string }[];
    legacyOwnerMessage?: "text" | "system";
    reason: "accepted" | "owner_replied" | null;
  };
  const CASES: Record<string, Case> = {
    proposed: { status: "proposed", reason: null },
    accepted: { status: "accepted", reason: "accepted" },
    rejectedSilently: {
      status: "rejected",
      thread: [{ author: null, body: "Exchange proposed" }],
      reason: null,
    },
    rejectedAfterReply: {
      status: "rejected",
      thread: [{ author: "owner", body: "No thanks" }],
      reason: "owner_replied",
    },
    cancelledAfterAccept: {
      status: "cancelled",
      thread: [
        { author: null, body: "Exchange proposed" },
        { author: null, body: "Exchange accepted" },
      ],
      reason: "accepted",
    },
    cancelledRequesterOnly: {
      status: "cancelled",
      thread: [
        { author: null, body: "Exchange proposed" },
        { author: "requester", body: "Hello?" },
      ],
      reason: null,
    },
    cancelledLegacyReply: {
      status: "cancelled",
      legacyOwnerMessage: "text",
      reason: "owner_replied",
    },
    // Evidence past the per-thread read cap is not seen: fails closed.
    rejectedReplyPastCap: {
      status: "rejected",
      thread: [
        ...Array.from({ length: 200 }, () => ({
          author: "requester" as const,
          body: "ping",
        })),
        { author: "owner", body: "Finally: no" },
      ],
      reason: null,
    },
    cancelledLegacySystemOnly: {
      status: "cancelled",
      legacyOwnerMessage: "system",
      reason: null,
    },
  };

  // One requester and one owner; reveals are per exchange, so the cases can share the pair.
  const seedHistory = (t: T) =>
    t.run(async (ctx) => {
      const mkUser = (who: string) =>
        ctx.db.insert("users", {
          clerkId: `clerk_${who}`,
          email: `${who}@example.com`,
          name: who,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        });
      const requester = await mkUser("requester");
      const owner = await mkUser("owner");
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "History",
        pieceCount: 500,
        status: "approved",
        submittedBy: owner,
        createdAt: 1,
        updatedAt: 1,
      });
      const exchanges: Record<string, Id<"exchanges">> = {};
      for (const [name, c] of Object.entries(CASES)) {
        const copy = await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: false, forSale: true, forLend: false },
          createdAt: 1,
          updatedAt: 1,
        });
        const exchangeId = await ctx.db.insert("exchanges", {
          aggregateId: `ex-${name}`,
          initiatorId: requester,
          recipientId: owner,
          type: "sale",
          requestedPuzzleId: copy,
          status: c.status,
          createdAt: 1,
          updatedAt: 1,
        });
        exchanges[name] = exchangeId;
        if (c.thread) {
          const threadAggregateId = `thread-${name}`;
          await ctx.db.insert("threads", {
            aggregateId: threadAggregateId,
            subjectKind: "exchange",
            exchangeId,
            participants: [requester, owner],
            participantsKey: [requester, owner].sort().join("|"),
            readReceipts: [],
            createdAt: 1,
          });
          let sentAt = 1;
          for (const m of c.thread) {
            await ctx.db.insert("threadMessages", {
              threadAggregateId,
              messageId: `${name}-${sentAt}`,
              ...(m.author === "owner"
                ? { authorId: owner }
                : m.author === "requester"
                  ? { authorId: requester }
                  : {}),
              kind: m.author === null ? "system" : "text",
              body: m.body,
              sentAt: sentAt++,
            });
          }
        }
        if (c.legacyOwnerMessage) {
          await ctx.db.insert("messages", {
            exchangeId,
            senderId: owner,
            receiverId: requester,
            content: "Let me check",
            messageType: c.legacyOwnerMessage,
            isRead: true,
            createdAt: 1,
          });
        }
      }
      return { exchanges };
    });

  const run = async (t: T, dryRun: boolean) => {
    const first = await t.mutation(
      internal.exchange.backfillTradeReveals.backfillTradeReveals,
      dryRun ? { dryRun } : {},
    );
    await flush(t);
    return first;
  };

  test("dry run counts without writing; the real run records owner-acted exchanges only; a re-run creates 0", async () => {
    const t = convexTest(schema, modules);
    const { exchanges } = await seedHistory(t);
    const scanned = Object.keys(CASES).length;
    const created = Object.values(CASES).filter((c) => c.reason).length;
    const notActed = scanned - created;

    expect(await run(t, true)).toEqual({
      scanned,
      created,
      existing: 0,
      notActed,
    });
    expect(await tradeReveals(t)).toHaveLength(0);

    expect(await run(t, false)).toEqual({
      scanned,
      created,
      existing: 0,
      notActed,
    });
    const rows = await tradeReveals(t);
    expect(rows).toHaveLength(created);
    for (const [name, c] of Object.entries(CASES)) {
      const row = rows.find((r) => r.exchangeId === exchanges[name]);
      expect(row?.reason ?? null).toBe(c.reason);
    }

    expect(await run(t, false)).toEqual({
      scanned,
      created: 0,
      existing: created,
      notActed,
    });
    expect(await tradeReveals(t)).toHaveLength(created);
  });
});

describe("per-trade reveal: data export", () => {
  test("the requester's export omits a hidden owner's id until the owner accepts", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    const exportOf = (who: string) =>
      as(t, who).query(api.insights.exportUserData.exportUserData, {});

    const before = await exportOf("requester");
    expect(before.exchanges).toHaveLength(1);
    expect(before.exchanges[0]).not.toHaveProperty("recipientId");
    expect(before.exchanges[0]!.initiatorId).toBe(w.requester);
    expect(JSON.stringify(before.exchanges)).not.toContain(w.owner);
    // The owner's own export always names the requester.
    expect((await exportOf("owner")).exchanges[0]!.initiatorId).toBe(
      w.requester,
    );

    await act(t, "owner", "accept", ex);
    const after = await exportOf("requester");
    expect(after.exchanges[0]!.recipientId).toBe(w.owner);
  });
});

describe("getTradePartner", () => {
  const card = async (t: T, who: string, exchangeId: string) =>
    as(t, who).query(api.exchange.getTradePartner.getTradePartner, {
      exchangeId: await docIdOf(t, exchangeId),
    });

  const addReview = (
    t: T,
    exchangeId: Id<"exchanges">,
    reviewerId: Id<"users">,
    revieweeId: Id<"users">,
    rating: number,
    createdAt: number,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("reviews", {
        exchangeId,
        reviewerId,
        revieweeId,
        rating,
        comment: `rated ${rating}`,
        categories: {
          communication: rating,
          packaging: rating,
          condition: rating,
          timeliness: rating,
        },
        createdAt,
      }),
    );

  test("the owner gets the requester's card with email and received reviews right after propose", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    const exId = await docIdOf(t, ex);
    // The third member reviewed the requester twice; the third member is private and unknown to
    // the owner, so their name stays off the card.
    await addReview(t, exId, w.third, w.requester, 4, 10);
    await addReview(t, exId, w.third, w.requester, 5, 20);

    const view = await card(t, "owner", ex);

    expect(view).toMatchObject({
      state: "revealed",
      memberId: w.requester,
      username: "requester",
      email: "requester@example.com",
      profileViewable: false,
      reviews: { averageRating: 4.5, totalReviews: 2 },
    });
    if (view?.state !== "revealed") throw new Error("unreachable");
    expect(view.reviews.items.map((r) => r.rating)).toEqual([5, 4]);
    expect(view.reviews.items[0]).not.toHaveProperty("reviewerName");
    const json = JSON.stringify(view);
    for (const leak of [
      w.third,
      "avatars/requester",
      "requester bio",
      "requester town",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  test("a revealed reviewer is named on the card", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.third, "public");
    const ex = await propose(t, "requester", w.copy);
    await addReview(t, await docIdOf(t, ex), w.third, w.requester, 3, 10);

    const view = await card(t, "owner", ex);
    if (view?.state !== "revealed") throw new Error("expected revealed");
    expect(view.reviews.items[0]?.reviewerName).toBe("X");
  });

  test("the requester gets { hidden } until the owner acts, then the card with email", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);

    expect(await card(t, "requester", ex)).toEqual({ state: "hidden" });

    await postInThread(t, "owner", ex, "Hi!");
    expect(await card(t, "requester", ex)).toMatchObject({
      state: "revealed",
      memberId: w.owner,
      email: "owner@example.com",
      profileViewable: false,
    });
  });

  test("a public owner is visible but their email waits for the owner to act", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.owner, "public");
    const ex = await propose(t, "requester", w.copy);

    const before = await card(t, "requester", ex);
    expect(before).toMatchObject({
      state: "revealed",
      memberId: w.owner,
      profileViewable: true,
    });
    expect(before).not.toHaveProperty("email");

    await act(t, "owner", "accept", ex);
    expect(await card(t, "requester", ex)).toMatchObject({
      email: "owner@example.com",
    });
  });

  test("the email stays inside its trade: a second trade with no owner action shows none", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.owner, "public");
    const first = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", first);
    const second = await propose(t, "requester", w.copy2);

    expect(await card(t, "requester", first)).toHaveProperty("email");
    expect(await card(t, "requester", second)).not.toHaveProperty("email");
  });

  test("departed counterparty and non-party", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);

    expect(await card(t, "third", ex)).toBeNull();
    await t.run((ctx) => ctx.db.patch(w.requester, { isActive: false }));
    expect(await card(t, "owner", ex)).toEqual({ state: "departed" });
  });
});

describe("a block between the trade parties", () => {
  const card = async (t: T, who: string, exchangeId: string) =>
    as(t, who).query(api.exchange.getTradePartner.getTradePartner, {
      exchangeId: await docIdOf(t, exchangeId),
    });
  const insertBlock = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("blocks", { blockerId, blockedId, createdAt: 1 }),
    );

  test("the blocked party sees the blocker hidden in the trade; the blocker keeps the trade view", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);
    // Both revealed by the trade before the block.
    expect((await card(t, "requester", ex))?.state).toBe("revealed");
    expect((await detail(t, "requester", ex))?.owner).not.toBeNull();

    await insertBlock(t, w.owner, w.requester);

    expect(await card(t, "requester", ex)).toEqual({ state: "hidden" });
    expect((await detail(t, "requester", ex))?.owner).toBeNull();
    // The blocker (byMe) keeps the ordinary trade rules.
    expect((await card(t, "owner", ex))?.state).toBe("revealed");
    expect((await detail(t, "owner", ex))?.requester).not.toBeNull();
  });
});
