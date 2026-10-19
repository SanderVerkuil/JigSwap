import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Sharing a puzzle in a circle group chat: postMessage's copyId gate and listAttachableCopies in a
// circle thread (the author's OWN open copy that the whole circle can see: shared into this circle,
// or the author's profile is public), and the per-viewer card at read time. Every profile is
// PRIVATE and nobody follows anybody unless a test says otherwise, so only the circle share
// reveals a copy.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const NONE = { forTrade: false, forSale: false, forLend: false };
const OPEN = { ...NONE, forTrade: true };

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: clerkId,
      visibility: "private",
      updatedAt: now,
    });
    return id;
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

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

let seq = 0;
// A copy of `title` owned by `ownerId`; shared into `circleId` when given.
const mkCopy = (
  t: T,
  ownerId: Id<"users">,
  title: string,
  options: {
    circleId?: string;
    extra?: Partial<Doc<"ownedPuzzles">>;
  } = {},
) =>
  t.run(async (ctx) => {
    seq += 1;
    const now = Date.now() + seq;
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: `def-${title}`,
      title,
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const aggregateId = `copy-${title}`;
    const id = await ctx.db.insert("ownedPuzzles", {
      aggregateId,
      puzzleId,
      ownerId,
      condition: "good",
      availability: OPEN,
      createdAt: now,
      updatedAt: now,
      ...options.extra,
    });
    if (options.circleId !== undefined) {
      await ctx.db.insert("circleCopyShares", {
        circleId: options.circleId,
        copyId: aggregateId,
        sharedAt: now,
      });
    }
    return id;
  });

const followMutually = (t: T, a: Id<"users">, b: Id<"users">) =>
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

// Alice owns "Puzzle Club"; Bob and Carol are members; Dave is outside it. Bob owns a copy shared
// into the circle, an open copy that isn't, and a closed (not open) copy that is.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  await flush(t);
  const threadId = (await as(t, "alice").mutation(
    api.conversation.openCircleThread.openCircleThread,
    { circleId },
  )) as string;
  await flush(t);
  const bobShared = await mkCopy(t, bob, "Bob Shared", { circleId });
  const bobUnshared = await mkCopy(t, bob, "Bob Unshared");
  const bobClosedShared = await mkCopy(t, bob, "Bob Closed", {
    circleId,
    extra: { availability: NONE },
  });
  const aliceShared = await mkCopy(t, alice, "Alice Shared", { circleId });
  return {
    alice,
    bob,
    carol,
    dave,
    circleId,
    threadId,
    bobShared,
    bobUnshared,
    bobClosedShared,
    aliceShared,
  };
};

const post = (
  t: T,
  clerkId: string,
  threadId: string,
  copyId: Id<"ownedPuzzles">,
) =>
  as(t, clerkId).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "Look at this one",
    copyId,
  });

const list = (t: T, clerkId: string, threadId: string, search?: string) =>
  as(t, clerkId).query(
    api.conversation.listAttachableCopies.listAttachableCopies,
    { threadId, side: "mine", ...(search !== undefined && { search }) },
  );

const copyMessagesOf = async (t: T, clerkId: string, threadId: string) =>
  (
    await as(t, clerkId).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    )
  ).filter((m) => m.copy !== undefined || m.copyUnavailable === true);

const setProfileVisibility = (
  t: T,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique();
    await ctx.db.patch(profile!._id, { visibility });
  });

// The placeholder carries nothing of the copy: no card, and none of its title, brand or cover
// anywhere in the message view.
const expectPlaceholder = (message: unknown, title: string) => {
  expect(message).toMatchObject({ copyUnavailable: true });
  expect((message as { copy?: unknown }).copy).toBeUndefined();
  const json = JSON.stringify(message);
  expect(json).not.toContain(title);
  expect(json).not.toContain("Ravensburger");
  expect(json).not.toContain("coverUrl");
};

describe("postMessage with copyId in a circle thread", () => {
  test("accepts the author's own copy shared into the circle; every member sees the card", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await post(t, "bob", s.threadId, s.bobShared);

    for (const viewer of ["alice", "bob", "carol"]) {
      const [message] = await copyMessagesOf(t, viewer, s.threadId);
      expect(message?.copy?.copyId).toBe(s.bobShared);
      expect(message?.copy?.title).toBe("Bob Shared");
    }
  });

  test("accepts the author's own open copy when their profile is public", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await setProfileVisibility(t, s.bob, "public");

    await post(t, "bob", s.threadId, s.bobUnshared);

    const [message] = await copyMessagesOf(t, "carol", s.threadId);
    expect(message?.copy?.copyId).toBe(s.bobUnshared);
  });

  test("refuses a copy some member can't see, even when others can", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // Carol may see Bob's whole library (mutual followers); Alice may not.
    await followMutually(t, s.bob, s.carol);

    await expectCode(post(t, "bob", s.threadId, s.bobUnshared), "CopyNotFound");
  });

  test("refuses an unshared copy of a private profile even when every member follows the author mutually", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // Every member could see it through rule 6; the circle rule deliberately doesn't count that.
    await followMutually(t, s.bob, s.alice);
    await followMutually(t, s.bob, s.carol);

    await expectCode(post(t, "bob", s.threadId, s.bobUnshared), "CopyNotFound");
  });

  test("a copy without an aggregateId qualifies only through a public profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const legacy = await mkCopy(t, s.bob, "Bob Legacy");
    await t.run((ctx) => ctx.db.patch(legacy, { aggregateId: undefined }));

    await expectCode(post(t, "bob", s.threadId, legacy), "CopyNotFound");

    await setProfileVisibility(t, s.bob, "public");
    await post(t, "bob", s.threadId, legacy);
    const [message] = await copyMessagesOf(t, "carol", s.threadId);
    expect(message?.copy?.copyId).toBe(legacy);
  });

  test("refuses once the circle row is gone", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const circle = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", s.circleId))
        .unique();
      await ctx.db.delete(circle!._id);
    });

    await expectCode(post(t, "bob", s.threadId, s.bobShared), "CopyNotFound");
  });

  test("refuses a shared copy that isn't open (the circle clause needs an open copy)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expectCode(
      post(t, "bob", s.threadId, s.bobClosedShared),
      "CopyNotFound",
    );
  });

  test("refuses another member's copy, even one the whole circle can see", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expectCode(post(t, "bob", s.threadId, s.aliceShared), "CopyNotFound");
  });

  test("refuses a copy shared into a different circle", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const otherCircle = (await as(t, "bob").mutation(
      api.sharing.createCircle.createCircle,
      { name: "Elsewhere" },
    )) as string;
    const elsewhere = await mkCopy(t, s.bob, "Bob Elsewhere", {
      circleId: otherCircle,
    });

    await expectCode(post(t, "bob", s.threadId, elsewhere), "CopyNotFound");
  });

  test("a member who blocked the author doesn't make the attach fail; they see the placeholder", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await as(t, "carol").mutation(api.social.blockMember.blockMember, {
      memberId: s.bob,
    });

    await post(t, "bob", s.threadId, s.bobShared);

    const [forCarol] = await copyMessagesOf(t, "carol", s.threadId);
    expectPlaceholder(forCarol, "Bob Shared");
    const [forAlice] = await copyMessagesOf(t, "alice", s.threadId);
    expect(forAlice?.copy?.copyId).toBe(s.bobShared);
  });

  test("a non-member can't attach (NotParticipant)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const daves = await mkCopy(t, s.dave, "Dave's");

    await expectCode(post(t, "dave", s.threadId, daves), "NotParticipant");
  });
});

describe("listAttachableCopies in a circle thread", () => {
  test("lists exactly the author's copies postMessage accepts, and nothing for 'theirs'", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await followMutually(t, s.bob, s.carol);

    const listed = (await list(t, "bob", s.threadId)).map((c) => c.copyId);
    expect(listed).toEqual([s.bobShared]);

    // Consistency with the gate, copy by copy.
    for (const copyId of [s.bobShared, s.bobUnshared, s.bobClosedShared]) {
      const accepted = await post(t, "bob", s.threadId, copyId).then(
        () => true,
        () => false,
      );
      expect(accepted).toBe(listed.includes(copyId));
    }

    expect(
      await as(t, "bob").query(
        api.conversation.listAttachableCopies.listAttachableCopies,
        { threadId: s.threadId, side: "theirs" },
      ),
    ).toEqual([]);
  });

  test("filters by search", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const second = await mkCopy(t, s.bob, "Harbour Lights", {
      circleId: s.circleId,
    });

    expect(
      (await list(t, "bob", s.threadId, "harbour")).map((c) => c.copyId),
    ).toEqual([second]);
  });

  test("a non-member is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expectCode(list(t, "dave", s.threadId), "NotParticipant");
  });

  test("a member who left is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId: s.circleId,
    });

    await expectCode(list(t, "bob", s.threadId), "NotParticipant");
  });
});

describe("a shared puzzle at read time, per viewer", () => {
  test("the card turns into the placeholder once the copy is deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await post(t, "bob", s.threadId, s.bobShared);

    await t.run((ctx) => ctx.db.delete(s.bobShared));

    for (const viewer of ["alice", "bob", "carol"]) {
      const [message] = await copyMessagesOf(t, viewer, s.threadId);
      expectPlaceholder(message, "Bob Shared");
    }
  });

  test("the card turns into the placeholder for the others once the copy is unshared; the owner keeps it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await post(t, "bob", s.threadId, s.bobShared);

    await t.run(async (ctx) => {
      const share = await ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle_copy", (q) =>
          q.eq("circleId", s.circleId).eq("copyId", "copy-Bob Shared"),
        )
        .unique();
      await ctx.db.delete(share!._id);
    });

    const [forAlice] = await copyMessagesOf(t, "alice", s.threadId);
    expectPlaceholder(forAlice, "Bob Shared");
    const [forBob] = await copyMessagesOf(t, "bob", s.threadId);
    expect(forBob?.copy?.copyId).toBe(s.bobShared);
  });

  test("a copy attached through a public profile turns into the placeholder once the profile goes private", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await setProfileVisibility(t, s.bob, "public");
    await post(t, "bob", s.threadId, s.bobUnshared);

    await setProfileVisibility(t, s.bob, "private");

    for (const viewer of ["alice", "carol"]) {
      const [message] = await copyMessagesOf(t, viewer, s.threadId);
      expectPlaceholder(message, "Bob Unshared");
    }
    const [forBob] = await copyMessagesOf(t, "bob", s.threadId);
    expect(forBob?.copy?.copyId).toBe(s.bobUnshared);
  });

  test("the card turns into the placeholder once its owner leaves the circle", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await post(t, "bob", s.threadId, s.bobShared);

    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId: s.circleId,
    });
    await flush(t);

    const [message] = await copyMessagesOf(t, "carol", s.threadId);
    expectPlaceholder(message, "Bob Shared");
  });

  test("the inbox lists no context copies for a circle thread", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await post(t, "bob", s.threadId, s.bobShared);

    const inbox = await as(t, "carol").query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    const row = inbox.find((thread) => thread.threadId === s.threadId);
    expect(row?.contextCopies).toEqual([]);
    expect(row?.lastMessage?.body).toBe("Look at this one");
  });

  test("a non-member can't read the thread", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await post(t, "bob", s.threadId, s.bobShared);

    await expectCode(
      as(t, "dave").query(
        api.conversation.getThreadMessages.getThreadMessages,
        { threadId: s.threadId },
      ),
      "NotParticipant",
    );
  });
});
