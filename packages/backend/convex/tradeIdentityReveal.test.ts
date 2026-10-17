import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { projectMemberIdentity } from "./social/privacy";

// Trade identity reveal (staged): proposing reveals the REQUESTER to the OWNER at once; the OWNER
// is revealed to the requester only by the owner's own action (accept, or a member-authored
// message in the exchange thread). Reveals are append-only grants (identityReveals) read by the
// privacy chokepoint. Both parties have PRIVATE profiles unless a test says otherwise.

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
  thirdCopy: Id<"ownedPuzzles">;
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
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const requester = await mkUser("requester", "Rita Requester");
    const owner = await mkUser("owner", "Olivia Owner");
    const third = await mkUser("third", "Theo Third");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
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
      copy: await mkCopy(owner),
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

/** Does `viewer` see `target`'s real identity through the privacy chokepoint? */
const sees = (t: T, viewer: Id<"users">, target: Id<"users">) =>
  t.run(
    async (ctx) =>
      !(await projectMemberIdentity(ctx, viewer, target, "salt")).anonymous,
  );

const grants = (t: T) =>
  t.run(async (ctx) => ctx.db.query("identityReveals").collect());

describe("trade identity reveal: grants", () => {
  test("proposing reveals the requester to the owner, not the owner to the requester", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    expect(await sees(t, w.owner, w.requester)).toBe(false);

    await propose(t, "requester", w.copy, w.owner);

    expect(await sees(t, w.owner, w.requester)).toBe(true);
    expect(await sees(t, w.requester, w.owner)).toBe(false);
    const rows = await grants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      viewerId: w.owner,
      targetId: w.requester,
      reason: "exchange_requested",
    });
  });

  test("accepting reveals the owner to the requester", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    await act(t, "owner", "accept", ex);

    expect(await sees(t, w.requester, w.owner)).toBe(true);
    const ownerGrant = (await grants(t)).find((g) => g.targetId === w.owner);
    expect(ownerGrant).toMatchObject({
      viewerId: w.requester,
      reason: "exchange_owner_acted",
    });
  });

  test("an owner-authored thread message reveals the owner without accepting", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    await postInThread(t, "owner", ex, "Which edition is yours?");

    expect(await sees(t, w.requester, w.owner)).toBe(true);
  });

  test("the requester's own messages and the lifecycle system messages never reveal the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    // The thread already carries the "Exchange proposed" system message (null author).
    await postInThread(t, "requester", ex, "Still interested?");

    expect(await sees(t, w.requester, w.owner)).toBe(false);
    expect(await grants(t)).toHaveLength(1);
  });

  test("declining before any reply keeps the owner anonymous", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    await act(t, "owner", "decline", ex);

    expect(await sees(t, w.requester, w.owner)).toBe(false);
    expect(await sees(t, w.owner, w.requester)).toBe(true);
  });

  test("reveals persist after completion", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "accept", ex);
    await act(t, "owner", "confirmCompletion", ex);
    await act(t, "requester", "confirmCompletion", ex);

    expect(await sees(t, w.requester, w.owner)).toBe(true);
    expect(await sees(t, w.owner, w.requester)).toBe(true);
  });

  test("reveals persist after cancelling an accepted exchange", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "accept", ex);
    await act(t, "requester", "cancel", ex);

    expect(await sees(t, w.requester, w.owner)).toBe(true);
    expect(await sees(t, w.owner, w.requester)).toBe(true);
  });

  test("reveals persist after cancelling a proposal the owner replied to", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await postInThread(t, "owner", ex);
    await act(t, "requester", "cancel", ex);

    expect(await sees(t, w.requester, w.owner)).toBe(true);
    expect(await sees(t, w.owner, w.requester)).toBe(true);
  });

  test("a third party is unaffected by other members' grants", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "accept", ex);

    for (const [a, b] of [
      [w.third, w.owner],
      [w.third, w.requester],
      [w.owner, w.third],
      [w.requester, w.third],
    ] as const) {
      expect(await sees(t, a, b)).toBe(false);
    }
  });

  test("a grant is idempotent per pair across several exchanges", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "decline", ex);
    await propose(t, "requester", w.copy, w.owner);

    expect(await grants(t)).toHaveLength(1);
  });

  test("public and mutual-follower rules are unchanged without any grant", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    expect(await sees(t, w.requester, w.owner)).toBe(false);
    await setVisibility(t, w.owner, "public");
    expect(await sees(t, w.requester, w.owner)).toBe(true);
    await setVisibility(t, w.owner, "private");
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
    expect(await sees(t, w.requester, w.owner)).toBe(true);
    expect(await grants(t)).toHaveLength(0);
  });
});

describe("trade identity reveal: the profile page", () => {
  test("the owner gets the requester's unlocked profile right after the proposal", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await t.run(async (ctx) => {
      const puzzleId = (await ctx.db.get(w.copy))!.puzzleId;
      await ctx.db.insert("completions", {
        userId: w.requester,
        puzzleId,
        startDate: 1,
        isCompleted: true,
        completionTimeMinutes: 90,
        photos: [],
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const profile = (who: string, handle: string) =>
      as(t, who).query(api.social.getPublicProfile.getPublicProfile, {
        handle,
      });
    const completions = (who: string, memberId: Id<"users">) =>
      as(t, who).query(
        api.social.listProfileCompletions.listProfileCompletions,
        { memberId, paginationOpts: { numItems: 10, cursor: null } } as never,
      );

    expect((await profile("owner", "requester"))?.locked).toBe(true);
    expect((await completions("owner", w.requester)).page).toHaveLength(0);
    await propose(t, "requester", w.copy, w.owner);

    expect((await profile("owner", "requester"))?.locked).toBe(false);
    expect(
      (await completions("owner", w.requester)).page.length,
    ).toBeGreaterThan(0);
    // The requester still finds the owner's profile LOCKED.
    expect((await profile("requester", "owner"))?.locked).toBe(true);
    // A third party gains nothing.
    expect((await profile("third", "requester"))?.locked).toBe(true);
  });

  test("the follow-graph and identity gates honour the grant", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await propose(t, "requester", w.copy, w.owner);

    const asOwner = as(t, "owner");
    expect(
      await asOwner.query(api.identity.getUserById.getUserById, {
        userId: w.requester,
      }),
    ).not.toBeNull();
    expect(
      await as(t, "requester").query(api.identity.getUserById.getUserById, {
        userId: w.owner,
      }),
    ).toBeNull();
    expect(
      await asOwner.query(api.social.getProfile.getProfile, {
        memberId: w.requester,
      }),
    ).not.toBeNull();
  });
});

const docIdOf = (t: T, aggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    return row!._id;
  });

const exchangeViews = async (t: T, who: string, exchangeId: string) => {
  const docId = await docIdOf(t, exchangeId);
  const reader = as(t, who);
  return {
    detail: await reader.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId: docId,
    }),
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

describe("trade identity reveal: exchange views", () => {
  test("the requester sees an anonymous owner with no raw owner id anywhere", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    const views = await exchangeViews(t, "requester", ex);

    expect(views.detail?.owner).toBeNull();
    expect(views.detail?.requester?._id).toBe(w.requester);
    expect(views.detail?.initiatorId).toBe(w.requester);
    expect(views.detail).not.toHaveProperty("recipientId");
    expect(views.detail?.ownerPuzzle).not.toHaveProperty("ownerId");
    expect(views.list).toHaveLength(1);
    expect(views.list[0]!.owner).toBeNull();
    expect(views.asRequester).toHaveLength(1);
    const json = JSON.stringify(views);
    expect(json).not.toContain(w.owner);
    expect(json).not.toContain("Olivia");
  });

  test("the owner sees the requester in every exchange view", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);

    const views = await exchangeViews(t, "owner", ex);

    expect(views.detail?.requester?.name).toBe("Rita Requester");
    expect(views.detail?.initiatorId).toBe(w.requester);
    expect(views.detail?.recipientId).toBe(w.owner);
    expect(views.detail?.ownerPuzzle?.ownerId).toBe(w.owner);
    expect(views.asOwner[0]!.requester?._id).toBe(w.requester);
    expect(views.list[0]!.requester?._id).toBe(w.requester);
  });

  test("after the owner accepts, the requester's views carry the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "accept", ex);

    const views = await exchangeViews(t, "requester", ex);

    expect(views.detail?.owner?.name).toBe("Olivia Owner");
    expect(views.detail?.recipientId).toBe(w.owner);
    expect(views.detail?.ownerPuzzle?.ownerId).toBe(w.owner);
    expect(views.list[0]!.owner?._id).toBe(w.owner);
  });

  test("a public owner stays visible to the requester as before", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.owner, "public");
    const ex = await propose(t, "requester", w.copy, w.owner);

    const views = await exchangeViews(t, "requester", ex);

    expect(views.detail?.owner?._id).toBe(w.owner);
    expect(views.detail?.recipientId).toBe(w.owner);
  });
});

describe("trade identity reveal: notifications", () => {
  test("the trade request names the requester to the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await propose(t, "requester", w.copy, w.owner);

    const request = (await notificationViews(t, "owner")).find(
      (n) => n.type === "trade_request",
    );
    expect(request?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.requester,
    });
  });

  test("a decline before any reply keeps the owner anonymous; an accept names them", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const declined = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "decline", declined);

    const decline = (await notificationViews(t, "requester")).find(
      (n) => n.type === "trade_declined",
    );
    expect(decline?.actors).toEqual([{ anonymous: true }]);
    expect(
      JSON.stringify(await notificationViews(t, "requester")),
    ).not.toContain(w.owner);

    const accepted = await propose(t, "requester", w.copy, w.owner);
    await act(t, "owner", "accept", accepted);
    const accept = (await notificationViews(t, "requester")).find(
      (n) => n.type === "trade_accepted",
    );
    expect(accept?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.owner,
    });
  });

  test("a decline after the owner replied names the owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy, w.owner);
    await postInThread(t, "owner", ex, "Sorry, it's promised to a friend");
    await act(t, "owner", "decline", ex);

    const decline = (await notificationViews(t, "requester")).find(
      (n) => n.type === "trade_declined",
    );
    expect(decline?.actors[0]).toMatchObject({
      anonymous: false,
      memberId: w.owner,
    });
  });
});

describe("proposing to an anonymous owner", () => {
  test("propose without a recipientId derives the copy's owner", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);

    const docId = await docIdOf(t, ex);
    const row = await t.run(async (ctx) => ctx.db.get(docId));
    expect(row?.recipientId).toBe(w.owner);
    expect(row?.initiatorId).toBe(w.requester);
    expect(await sees(t, w.owner, w.requester)).toBe(true);
    expect(await sees(t, w.requester, w.owner)).toBe(false);
  });

  test("a wrong explicit recipientId is still rejected", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await expect(
      as(t, "requester").mutation(api.exchange.propose.propose, {
        recipientId: w.third,
        type: "sale",
        salePrice: 10,
        requestedPuzzleId: w.copy,
      }),
    ).rejects.toThrow(/RecipientNotOwner/);
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

  test("true for a private requester the owner can't see yet", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      revealsRequester: true,
    });
  });

  test("false for a public requester", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await setVisibility(t, w.requester, "public");
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      revealsRequester: false,
    });
  });

  test("false for mutual followers", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: w.requester,
        followeeId: w.owner,
        createdAt: 1,
      });
      await ctx.db.insert("follows", {
        followerId: w.owner,
        followeeId: w.requester,
        createdAt: 1,
      });
    });
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      revealsRequester: false,
    });
  });

  test("false once already granted to an owner the requester can identify", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, "requester", w.copy);
    await act(t, "owner", "accept", ex);
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      revealsRequester: false,
    });
  });

  test("a grant toward a still-anonymous owner does not link their other copies", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await propose(t, "requester", w.copy); // owner sees requester; owner stays anonymous
    expect(await disclosure(t, "requester", w.copy)).toEqual({
      revealsRequester: true,
    });
  });

  test("null for the owner's own copy, a missing copy, or a signed-out caller", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
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

describe("backfillIdentityReveals", () => {
  type Case = {
    status: "proposed" | "accepted" | "rejected" | "cancelled";
    thread?: { author: "owner" | "requester" | null; body: string }[];
    legacyOwnerMessage?: boolean;
    ownerActed: boolean;
  };
  const CASES: Record<string, Case> = {
    proposed: { status: "proposed", ownerActed: false },
    accepted: { status: "accepted", ownerActed: true },
    rejectedSilently: {
      status: "rejected",
      thread: [{ author: null, body: "Exchange proposed" }],
      ownerActed: false,
    },
    rejectedAfterReply: {
      status: "rejected",
      thread: [{ author: "owner", body: "No thanks" }],
      ownerActed: true,
    },
    cancelledAfterAccept: {
      status: "cancelled",
      thread: [
        { author: null, body: "Exchange proposed" },
        { author: null, body: "Exchange accepted" },
      ],
      ownerActed: true,
    },
    cancelledRequesterOnly: {
      status: "cancelled",
      thread: [
        { author: null, body: "Exchange proposed" },
        { author: "requester", body: "Hello?" },
      ],
      ownerActed: false,
    },
    cancelledLegacyReply: {
      status: "cancelled",
      legacyOwnerMessage: true,
      ownerActed: true,
    },
  };

  // One private requester; a distinct private owner per case (grants are global per pair).
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
      const owners: Record<string, Id<"users">> = {};
      for (const [name, c] of Object.entries(CASES)) {
        const owner = await mkUser(`owner-${name}`);
        owners[name] = owner;
        const puzzleId = await ctx.db.insert("puzzles", {
          title: name,
          pieceCount: 500,
          status: "approved",
          submittedBy: owner,
          createdAt: 1,
          updatedAt: 1,
        });
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
            messageType: "text",
            isRead: true,
            createdAt: 1,
          });
        }
      }
      return { requester, owners };
    });

  const run = async (t: T, dryRun: boolean) => {
    const first = await t.mutation(
      internal.social.backfillIdentityReveals.backfillIdentityReveals,
      dryRun ? { dryRun } : {},
    );
    await flush(t);
    return first;
  };

  test("dry run counts without writing; the real run creates the expected grants; a re-run creates 0", async () => {
    const t = convexTest(schema, modules);
    const { requester, owners } = await seedHistory(t);
    const actedCount = Object.values(CASES).filter((c) => c.ownerActed).length;
    const expected = Object.keys(CASES).length + actedCount;

    const dry = await run(t, true);
    expect(dry).toEqual({ scanned: 7, created: expected, existing: 0 });
    expect(await grants(t)).toHaveLength(0);

    const real = await run(t, false);
    expect(real).toEqual({ scanned: 7, created: expected, existing: 0 });
    const rows = await grants(t);
    expect(rows).toHaveLength(expected);
    for (const [name, c] of Object.entries(CASES)) {
      const owner = owners[name]!;
      expect(
        rows.some((g) => g.viewerId === owner && g.targetId === requester),
      ).toBe(true);
      expect(
        rows.some((g) => g.viewerId === requester && g.targetId === owner),
      ).toBe(c.ownerActed);
    }

    const again = await run(t, false);
    expect(again).toEqual({ scanned: 7, created: 0, existing: expected });
    expect(await grants(t)).toHaveLength(expected);
  });
});
