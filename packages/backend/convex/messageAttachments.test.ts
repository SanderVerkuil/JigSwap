import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Attaching a copy to a message: postMessage's optional copyId gate (owned by a participant,
// viewable by BOTH participants, else CopyNotFound) and the picker's listAttachableCopies, which
// lists exactly the copies that gate would accept.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    let now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    const mkCopy = async (
      ownerId: Id<"users">,
      title: string,
      brand: string,
      availability: typeof OPEN,
    ) => {
      now += 1;
      const puzzleId = await ctx.db.insert("puzzles", {
        title,
        brand,
        pieceCount: 1000,
        status: "approved",
        submittedBy: ownerId,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });
    };
    // Everyone's profile is public (no rows): open copies are viewable by all, closed only by
    // their owner.
    const aliceOpen = await mkCopy(alice, "Alpine Lake", "Ravensburger", OPEN);
    const aliceClosed = await mkCopy(alice, "Hidden Garden", "Jumbo", CLOSED);
    const bobOpen = await mkCopy(bob, "Starry Night", "Clementoni", OPEN);
    const bobOpen2 = await mkCopy(bob, "Night Market", "Heye", OPEN);
    const bobClosed = await mkCopy(bob, "Secret Shelf", "Jumbo", CLOSED);
    const carolOpen = await mkCopy(carol, "Carol's Castle", "Jumbo", OPEN);
    return {
      alice,
      bob,
      carol,
      aliceOpen,
      aliceClosed,
      bobOpen,
      bobOpen2,
      bobClosed,
      carolOpen,
    };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_carol" });

const followMutually = (
  t: TestConvex<typeof schema>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: a,
      followeeId: b,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: b,
      followeeId: a,
      createdAt: 2,
    });
  });

// Ends the mutual follow (for example Alice stops following Bob): mutual followers see each other's whole
// library, so a closed copy only becomes unviewable to the partner once they are no longer mutual.
const endMutualFollow = (
  t: TestConvex<typeof schema>,
  follower: Id<"users">,
  followee: Id<"users">,
) =>
  t.run(async (ctx) => {
    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", follower).eq("followeeId", followee),
      )
      .unique();
    if (edge) await ctx.db.delete(edge._id);
  });

const flushScheduled = async (t: TestConvex<typeof schema>) => {
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

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

// A mutual-follow DM between Alice and Bob.
const aliceBobDm = async (t: TestConvex<typeof schema>, s: Seeded) => {
  await followMutually(t, s.alice, s.bob);
  return asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId: s.bob,
  });
};

const post = (
  viewer: ReturnType<typeof asAlice>,
  threadId: string,
  copyId: Id<"ownedPuzzles">,
) =>
  viewer.mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "Look at this one",
    copyId,
  });

const messageCount = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => (await ctx.db.query("threadMessages").collect()).length);

describe("postMessage with copyId", () => {
  test("accepts each participant's copy that both can view, and surfaces it as the card", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);

    await post(asAlice(t), threadId, s.aliceOpen);
    await post(asAlice(t), threadId, s.bobOpen);
    await post(asBob(t), threadId, s.aliceOpen);

    const messages = await asBob(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(messages.map((m) => m.copy?.copyId)).toEqual([
      s.aliceOpen,
      s.bobOpen,
      s.aliceOpen,
    ]);
  });

  test("rejects a third party's copy, even a publicly viewable one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await expectConvexCode(
      post(asAlice(t), threadId, s.carolOpen),
      "CopyNotFound",
    );
    expect(await messageCount(t)).toBe(0);
  });

  test("rejects a copy one participant cannot view — even when its owner sends it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    // No longer mutual: Bob's closed copy is now his alone to view (the thread itself remains).
    await endMutualFollow(t, s.alice, s.bob);
    await expectConvexCode(
      post(asBob(t), threadId, s.bobClosed),
      "CopyNotFound",
    );
    await expectConvexCode(
      post(asAlice(t), threadId, s.bobClosed),
      "CopyNotFound",
    );
    expect(await messageCount(t)).toBe(0);
  });

  test("rejects a non-existent copy id", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await t.run((ctx) => ctx.db.delete(s.bobOpen));
    await expectConvexCode(
      post(asAlice(t), threadId, s.bobOpen),
      "CopyNotFound",
    );
  });

  test("a non-participant author is rejected as NotParticipant, before any copy check", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await expectConvexCode(
      post(asCarol(t), threadId, s.bobOpen),
      "NotParticipant",
    );
    await expectConvexCode(
      post(asCarol(t), threadId, s.carolOpen),
      "NotParticipant",
    );
    expect(await messageCount(t)).toBe(0);
  });

  test("exchange threads follow the same rules", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: s.bob,
      type: "trade",
      requestedPuzzleId: s.bobOpen,
      offeredPuzzleId: s.aliceOpen,
    });
    await flushScheduled(t);
    const [row] = await asAlice(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(row.subject.kind).toBe("exchange");

    await post(asAlice(t), row.threadId, s.bobOpen2);
    await expectConvexCode(
      post(asAlice(t), row.threadId, s.carolOpen),
      "CopyNotFound",
    );
  });
});

describe("listAttachableCopies", () => {
  const list = (
    viewer: ReturnType<typeof asAlice>,
    threadId: string,
    side: "mine" | "theirs",
    search?: string,
  ) =>
    viewer.query(api.conversation.listAttachableCopies.listAttachableCopies, {
      threadId,
      side,
      search,
    });

  test("participants only", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await expectConvexCode(
      list(asCarol(t), threadId, "mine"),
      "NotParticipant",
    );
    await expectConvexCode(
      list(asAlice(t), "no-such-thread", "mine"),
      "ThreadNotFound",
    );
  });

  test("mutual followers can attach each other's closed copies too", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    expect(
      (await list(asAlice(t), threadId, "mine")).map((c) => c.copyId),
    ).toEqual([s.aliceClosed, s.aliceOpen]);
    expect(
      (await list(asAlice(t), threadId, "theirs")).map((c) => c.copyId),
    ).toEqual([s.bobClosed, s.bobOpen2, s.bobOpen]);
    await post(asAlice(t), threadId, s.bobClosed);
  });

  test("mine: the caller's copies the other participant can view (no longer mutual)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await endMutualFollow(t, s.bob, s.alice);
    const mine = await list(asAlice(t), threadId, "mine");
    expect(mine.map((c) => c.copyId)).toEqual([s.aliceOpen]);
    expect(mine[0]).toMatchObject({
      title: "Alpine Lake",
      brand: "Ravensburger",
      pieceCount: 1000,
    });
  });

  test("theirs: the other participant's copies the caller can view, newest first (no longer mutual)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await endMutualFollow(t, s.bob, s.alice);
    expect(
      (await list(asAlice(t), threadId, "theirs")).map((c) => c.copyId),
    ).toEqual([s.bobOpen2, s.bobOpen]);
    // The same DM from Bob's side.
    expect(
      (await list(asBob(t), threadId, "mine")).map((c) => c.copyId),
    ).toEqual([s.bobOpen2, s.bobOpen]);
    expect(
      (await list(asBob(t), threadId, "theirs")).map((c) => c.copyId),
    ).toEqual([s.aliceOpen]);
  });

  test("visibility tracks the viewer: a copy Alice holds is attachable for her", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    await t.run((ctx) => ctx.db.patch(s.bobClosed, { heldBy: s.alice }));
    expect(
      (await list(asAlice(t), threadId, "theirs")).map((c) => c.copyId),
    ).toContain(s.bobClosed);
    // And postMessage accepts exactly what the picker lists.
    await post(asAlice(t), threadId, s.bobClosed);
  });

  test("search: case-insensitive substring on title or brand", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    expect(
      (await list(asAlice(t), threadId, "theirs", "  NIGHT ")).map(
        (c) => c.copyId,
      ),
    ).toEqual([s.bobOpen2, s.bobOpen]);
    expect(
      (await list(asAlice(t), threadId, "theirs", "starry")).map(
        (c) => c.copyId,
      ),
    ).toEqual([s.bobOpen]);
    expect(
      (await list(asAlice(t), threadId, "theirs", "heye")).map((c) => c.copyId),
    ).toEqual([s.bobOpen2]);
    expect(await list(asAlice(t), threadId, "theirs", "zzz")).toEqual([]);
  });

  test("theirs is empty while the other member is anonymised to the caller", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const threadId = await aliceBobDm(t, s);
    // A copy Alice can view regardless of Bob's profile: she holds it.
    await t.run((ctx) => ctx.db.patch(s.bobClosed, { heldBy: s.alice }));
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId: s.bob,
        visibility: "private",
        updatedAt: Date.now(),
      }),
    );
    // Mutual followers: Alice sees Bob's whole library.
    expect(
      (await list(asAlice(t), threadId, "theirs")).map((c) => c.copyId),
    ).toEqual([s.bobClosed, s.bobOpen2, s.bobOpen]);

    // Alice unfollows: Bob (private) is now anonymised to her.
    await t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", s.alice).eq("followeeId", s.bob),
        )
        .unique();
      if (edge) await ctx.db.delete(edge._id);
    });
    expect(await list(asAlice(t), threadId, "theirs")).toEqual([]);
  });
});
