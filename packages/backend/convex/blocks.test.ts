import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";
import { establishMutualFollow } from "./social/establishMutualFollow";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice"),
      bob: await mkUser("clerk_bob"),
      carol: await mkUser("clerk_carol"),
    };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

const followMutually = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    for (const [followerId, followeeId] of [
      [a, b],
      [b, a],
    ] as const) {
      await ctx.db.insert("follows", {
        aggregateId: crypto.randomUUID(),
        followerId,
        followeeId,
        createdAt: Date.now(),
      });
    }
  });

// A pre-aggregateId follow edge, as older rows still are.
const legacyFollow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 }),
  );

// A shared circle is a connection clause a block can't sever (circles are left unchanged).
const shareCircle = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    const circleAggregateId = crypto.randomUUID();
    await ctx.db.insert("circleMembers", { circleAggregateId, memberId: a });
    await ctx.db.insert("circleMembers", { circleAggregateId, memberId: b });
  });

// A block row written directly, to test a gate without blockMember's side effects.
const insertBlock = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const seedSaleCopy = (t: T, owner: Id<"users">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
  });

const proposeSale = (
  t: T,
  as: "alice" | "bob",
  recipientId: Id<"users">,
  copyId: Id<"ownedPuzzles">,
) =>
  (as === "alice" ? asAlice(t) : asBob(t)).mutation(
    api.exchange.propose.propose,
    { recipientId, type: "sale", requestedPuzzleId: copyId, salePrice: 10 },
  );

const exchangeStatus = (t: T, exchangeId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
          .unique()
      )?.status,
  );

// Drain the async event dispatcher (exchange threads open from a scheduled subscriber).
const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

const followEdge = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", followerId).eq("followeeId", followeeId),
        )
        .first()) !== null,
  );

const post = (t: T, as: "alice" | "bob", threadId: string, body = "hi") =>
  (as === "alice" ? asAlice(t) : asBob(t)).mutation(
    api.conversation.postMessage.postMessage,
    { threadId, kind: "text", body },
  );

// Each scenario runs with alice blocking bob AND with bob blocking alice: every gate must hold
// in both directions.
const directions = [
  { name: "blocker acts", blocker: "alice" },
  { name: "blocked member acts", blocker: "bob" },
] as const;

describe("blocked pair is refused", () => {
  for (const { name, blocker } of directions) {
    describe(name, () => {
      const block = (t: T, ids: { alice: Id<"users">; bob: Id<"users"> }) =>
        blocker === "alice"
          ? asAlice(t).mutation(api.social.blockMember.blockMember, {
              memberId: ids.bob,
            })
          : asBob(t).mutation(api.social.blockMember.blockMember, {
              memberId: ids.alice,
            });

      test("openDmThread (including the idempotent reopen), canMessage and posting in an existing DM", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        await shareCircle(t, ids.alice, ids.bob);
        const threadId = await asAlice(t).mutation(
          api.conversation.openDmThread.openDmThread,
          { recipientId: ids.bob },
        );
        await block(t, ids);

        await expectCode(
          asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
            recipientId: ids.bob,
          }),
          "NotConnected",
        );
        await expectCode(
          asBob(t).mutation(api.conversation.openDmThread.openDmThread, {
            recipientId: ids.alice,
          }),
          "NotConnected",
        );
        expect(
          await asAlice(t).query(api.conversation.canMessage.canMessage, {
            recipientId: ids.bob,
          }),
        ).toBe(false);
        expect(
          await asBob(t).query(api.conversation.canMessage.canMessage, {
            recipientId: ids.alice,
          }),
        ).toBe(false);
        await expectCode(post(t, "alice", threadId), "CannotReply");
        await expectCode(post(t, "bob", threadId), "CannotReply");
      });

      test("listAttachableCopies lists nothing on either side", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        await shareCircle(t, ids.alice, ids.bob);
        await seedSaleCopy(t, ids.alice);
        await seedSaleCopy(t, ids.bob);
        const threadId = await asAlice(t).mutation(
          api.conversation.openDmThread.openDmThread,
          { recipientId: ids.bob },
        );
        const list = (as: "alice" | "bob", side: "mine" | "theirs") =>
          (as === "alice" ? asAlice(t) : asBob(t)).query(
            api.conversation.listAttachableCopies.listAttachableCopies,
            { threadId, side },
          );
        expect(await list("alice", "theirs")).toHaveLength(1);
        await block(t, ids);

        for (const as of ["alice", "bob"] as const) {
          expect(await list(as, "mine")).toEqual([]);
          expect(await list(as, "theirs")).toEqual([]);
        }
      });

      test("startCopyConversation", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        await shareCircle(t, ids.alice, ids.bob);
        const copyId = await seedSaleCopy(t, ids.bob);
        await asAlice(t).mutation(
          api.conversation.startCopyConversation.startCopyConversation,
          { copyId, body: "is this still available?" },
        );
        await block(t, ids);

        await expectCode(
          asAlice(t).mutation(
            api.conversation.startCopyConversation.startCopyConversation,
            { copyId, body: "hello again" },
          ),
          "NotConnected",
        );
      });

      test("posting in an existing exchange thread; the accepted exchange itself is untouched", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        const copyId = await seedSaleCopy(t, ids.bob);
        const exchangeId = await proposeSale(t, "alice", ids.bob, copyId);
        await asBob(t).mutation(api.exchange.accept.accept, { exchangeId });
        await flushScheduled(t);
        const threadId = await asAlice(t).query(
          api.conversation.getThreadByExchange.getThreadByExchange,
          { exchangeId },
        );
        expect(threadId).not.toBeNull();
        await block(t, ids);

        await expectCode(post(t, "alice", threadId!), "CannotReply");
        await expectCode(post(t, "bob", threadId!), "CannotReply");
        expect(await exchangeStatus(t, exchangeId)).toBe("accepted");
      });

      test("follow, in both directions", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        await block(t, ids);

        await expectCode(
          asAlice(t).mutation(api.social.followMember.followMember, {
            followeeId: ids.bob,
          }),
          "NotConnected",
        );
        await expectCode(
          asBob(t).mutation(api.social.followMember.followMember, {
            followeeId: ids.alice,
          }),
          "NotConnected",
        );
      });

      test("propose, in both directions", async () => {
        const t = convexTest(schema, modules);
        const ids = await seed(t);
        const bobsCopy = await seedSaleCopy(t, ids.bob);
        const alicesCopy = await seedSaleCopy(t, ids.alice);
        await block(t, ids);

        await expectCode(
          proposeSale(t, "alice", ids.bob, bobsCopy),
          "NotConnected",
        );
        await expectCode(
          proposeSale(t, "bob", ids.alice, alicesCopy),
          "NotConnected",
        );
        // recipientId is optional (derived from the copy's owner): the gate still holds.
        await expectCode(
          asAlice(t).mutation(api.exchange.propose.propose, {
            type: "sale",
            requestedPuzzleId: bobsCopy,
            salePrice: 10,
          }),
          "NotConnected",
        );
      });
    });
  }

  test("approving a pending follow request", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: "request-alice-bob",
        requesterId: alice,
        targetId: bob,
        status: "pending",
        createdAt: Date.now(),
      }),
    );
    await insertBlock(t, alice, bob);

    await expectCode(
      asBob(t).mutation(api.social.approveFollowRequest.approveFollowRequest, {
        requestId: "request-alice-bob",
      }),
      "NotConnected",
    );
    expect(await followEdge(t, alice, bob)).toBe(false);
  });

  test("accepting a pending proposal", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const copyId = await seedSaleCopy(t, bob);
    const exchangeId = await proposeSale(t, "alice", bob, copyId);
    await insertBlock(t, alice, bob);

    await expectCode(
      asBob(t).mutation(api.exchange.accept.accept, { exchangeId }),
      "NotConnected",
    );
    expect(await exchangeStatus(t, exchangeId)).toBe("proposed");
  });

  test("token follows (QR / invite) create no edges", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await insertBlock(t, bob, alice);

    const result = await t.run((ctx) => establishMutualFollow(ctx, alice, bob));
    expect(result).toEqual({ established: false, edgesCreated: 0 });
    expect(await followEdge(t, alice, bob)).toBe(false);
    expect(await followEdge(t, bob, alice)).toBe(false);
  });
});

describe("blockMember side effects", () => {
  test("severs follows and declines pending requests both ways, closes pending proposals as the blocker, leaves accepted exchanges", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await t.run(async (ctx) => {
      for (const [aggregateId, requesterId, targetId] of [
        ["request-ab", alice, bob],
        ["request-ba", bob, alice],
      ] as const) {
        await ctx.db.insert("followRequests", {
          aggregateId,
          requesterId,
          targetId,
          status: "pending",
          createdAt: Date.now(),
        });
      }
    });
    const accepted = await proposeSale(
      t,
      "alice",
      bob,
      await seedSaleCopy(t, bob),
    );
    await asBob(t).mutation(api.exchange.accept.accept, {
      exchangeId: accepted,
    });
    const fromAlice = await proposeSale(
      t,
      "alice",
      bob,
      await seedSaleCopy(t, bob),
    );
    const fromBob = await proposeSale(
      t,
      "bob",
      alice,
      await seedSaleCopy(t, alice),
    );
    await flushScheduled(t);

    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: bob,
    });
    await flushScheduled(t);

    expect(await followEdge(t, alice, bob)).toBe(false);
    expect(await followEdge(t, bob, alice)).toBe(false);
    const requests = await t.run((ctx) =>
      ctx.db.query("followRequests").collect(),
    );
    expect(requests.map((r) => r.status)).toEqual(["declined", "declined"]);
    // Alice (the blocker) cancels her own proposal and declines bob's: nothing is attributed to
    // bob, who never acted.
    expect(await exchangeStatus(t, fromAlice)).toBe("cancelled");
    expect(await exchangeStatus(t, fromBob)).toBe("rejected");
    expect(await exchangeStatus(t, accepted)).toBe("accepted");

    // Each closure flows like a normal one: its thread gets the lifecycle system message.
    const systemBodies = async (exchangeId: string) => {
      const threadId = await asAlice(t).query(
        api.conversation.getThreadByExchange.getThreadByExchange,
        { exchangeId },
      );
      const messages = await t.run((ctx) =>
        ctx.db
          .query("threadMessages")
          .withIndex("by_thread_sent", (q) =>
            q.eq("threadAggregateId", threadId!),
          )
          .collect(),
      );
      return messages.filter((m) => m.kind === "system").map((m) => m.body);
    };
    expect(await systemBodies(fromBob)).toEqual([
      "Exchange proposed",
      "Exchange rejected",
    ]);
    expect(await systemBodies(fromAlice)).toEqual([
      "Exchange proposed",
      "Exchange cancelled",
    ]);
    // No "they cancelled" ever reaches the blocker: bob didn't do anything.
    const alicesNotifications = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .filter((q) => q.eq(q.field("userId"), alice))
        .collect(),
    );
    expect(
      alicesNotifications.filter((n) =>
        ["trade_cancelled", "trade_declined"].includes(n.type),
      ),
    ).toEqual([]);
    const bobsNotifications = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .filter((q) => q.eq(q.field("userId"), bob))
        .collect(),
    );
    expect(
      bobsNotifications
        .map((n) => n.type)
        .filter((type) => ["trade_cancelled", "trade_declined"].includes(type))
        .sort(),
    ).toEqual(["trade_cancelled", "trade_declined"]);
  });

  test("the inbox keeps the thread; the blocker sees the block, the blocked member a read-only thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: bob,
    });
    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: bob,
    });

    const mine = await asAlice(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    const theirs = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.blocked).toBe("byMe");
    expect(mine[0]!.readOnly).toBeUndefined();
    expect(theirs).toHaveLength(1);
    // The blocked member never learns of the block: the thread is just read-only.
    expect(theirs[0]!.blocked).toBeUndefined();
    expect(theirs[0]!.readOnly).toBe(true);
  });
});

describe("unblockMember", () => {
  test("does not restore follows; messaging needs another connection clause", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    await followMutually(t, alice, bob);
    await legacyFollow(t, alice, carol);
    await shareCircle(t, alice, carol);
    for (const memberId of [bob, carol]) {
      await asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId,
      });
      await asAlice(t).mutation(api.social.unblockMember.unblockMember, {
        memberId,
      });
    }

    expect(await followEdge(t, alice, bob)).toBe(false);
    expect(await followEdge(t, bob, alice)).toBe(false);
    expect(
      await asAlice(t).query(api.conversation.canMessage.canMessage, {
        recipientId: bob,
      }),
    ).toBe(false);
    // Carol still shares a circle with alice, so that clause holds again.
    expect(
      await asAlice(t).query(api.conversation.canMessage.canMessage, {
        recipientId: carol,
      }),
    ).toBe(true);
    expect(
      await asAlice(t).query(api.social.listMyBlocks.listMyBlocks, {}),
    ).toEqual([]);
  });
});

describe("blockMember rules", () => {
  test("is idempotent and lists blocks newest first", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: bob,
    });
    await new Promise((resolve) => setTimeout(resolve, 3));
    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: carol,
    });
    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: bob,
    });

    const rows = await t.run((ctx) => ctx.db.query("blocks").collect());
    expect(rows).toHaveLength(2);
    const list = await asAlice(t).query(
      api.social.listMyBlocks.listMyBlocks,
      {},
    );
    expect(list.map((row) => row.memberId)).toEqual([carol, bob]);
    expect(list[0]).toMatchObject({ name: "clerk_carol", handle: carol });
    expect(list[0]!.blockedAt).toBeGreaterThan(list[1]!.blockedAt);
    // Only the blocker sees their list.
    expect(
      await asBob(t).query(api.social.listMyBlocks.listMyBlocks, {}),
    ).toEqual([]);
  });

  test("can't block yourself", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expectCode(
      asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: alice,
      }),
      "CannotBlockSelf",
    );
  });

  test("the rate limit applies before the member-exists check", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        clerkId: "clerk_gone",
        email: "gone@example.com",
        name: "gone",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expectCode(
      asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: gone,
      }),
      "MemberNotFound",
    );
    for (let i = 0; i < RATE_LIMITS.blockToggle.max; i++) {
      await asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: bob,
      });
    }
    await expectCode(
      asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: gone,
      }),
      "RateLimited",
    );
  });

  test("block and unblock share the blockToggle rate limit", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    for (let i = 0; i < RATE_LIMITS.blockToggle.max / 2; i++) {
      await asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: bob,
      });
      await asAlice(t).mutation(api.social.unblockMember.unblockMember, {
        memberId: bob,
      });
    }
    await expectCode(
      asAlice(t).mutation(api.social.blockMember.blockMember, {
        memberId: bob,
      }),
      "RateLimited",
    );
    await expectCode(
      asAlice(t).mutation(api.social.unblockMember.unblockMember, {
        memberId: bob,
      }),
      "RateLimited",
    );
  });
});

describe("startCopyConversation hardening", () => {
  test("counts toward the messagePost rate limit shared with postMessage", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const copyId = await seedSaleCopy(t, bob);
    const start = () =>
      asAlice(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId, body: "is this still available?" },
      );
    let threadId = "";
    for (let i = 0; i < RATE_LIMITS.messagePost.max; i++) {
      threadId = await start();
    }

    await expectCode(start(), "RateLimited");
    await expectCode(post(t, "alice", threadId), "RateLimited");
  });

  test("a blocked pair is refused even with another connection clause, and no thread is opened", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await shareCircle(t, alice, bob);
    const copyId = await seedSaleCopy(t, bob);
    await insertBlock(t, bob, alice);

    await expectCode(
      asAlice(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId, body: "hello" },
      ),
      "NotConnected",
    );
    expect(await t.run((ctx) => ctx.db.query("threads").collect())).toEqual([]);
  });
});
