import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// "Message" on a copy: getCopyConversation resolves where the button should land (an existing
// DM with the copy's owner, or a new-conversation view) and startCopyConversation creates the
// DM on first send, with the copy referenced on that first message. The owner is always derived
// from the copy server-side.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
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
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    // Bob's profile is public (no profile row) and this copy is open, so anyone can view it.
    const openCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    // No availability flag set and not shared: only Bob can view it.
    const closedCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, openCopy, closedCopy };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

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

const threadCount = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => (await ctx.db.query("threads").collect()).length);

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

describe("getCopyConversation", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    await expect(
      t.query(api.conversation.getCopyConversation.getCopyConversation, {
        copyId: openCopy,
      }),
    ).rejects.toThrow();
  });

  test("a copy the viewer may not view is unavailable", async () => {
    const t = convexTest(schema, modules);
    const { closedCopy } = await seed(t);
    const view = await asAlice(t).query(
      api.conversation.getCopyConversation.getCopyConversation,
      { copyId: closedCopy },
    );
    expect(view).toEqual({ status: "unavailable" });
  });

  test("the owner gets `self`", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    const view = await asBob(t).query(
      api.conversation.getCopyConversation.getCopyConversation,
      { copyId: openCopy },
    );
    expect(view).toEqual({ status: "self" });
  });

  test("without a thread: a new-conversation view with the copy card and the projected owner", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);

    const view = await asAlice(t).query(
      api.conversation.getCopyConversation.getCopyConversation,
      { copyId: openCopy },
    );
    expect(view.status).toBe("new");
    if (view.status !== "new") return;
    expect(view.canMessage).toBe(true);
    expect(view.copy).toMatchObject({
      copyId: openCopy,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
    });
    expect(view.owner.anonymous).toBe(false);
    // Reading never creates a thread.
    expect(await threadCount(t)).toBe(0);
  });

  test("privacy: an unconnected viewer sees the view with canMessage false", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    const view = await asAlice(t).query(
      api.conversation.getCopyConversation.getCopyConversation,
      { copyId: openCopy },
    );
    expect(view.status === "new" && view.canMessage).toBe(false);
  });

  test("an existing DM with the owner is reused", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );

    const view = await asAlice(t).query(
      api.conversation.getCopyConversation.getCopyConversation,
      { copyId: openCopy },
    );
    expect(view).toEqual({ status: "existing", threadId });
  });
});

describe("startCopyConversation", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    await expect(
      t.mutation(api.conversation.startCopyConversation.startCopyConversation, {
        copyId: openCopy,
        body: "hi",
      }),
    ).rejects.toThrow();
    expect(await threadCount(t)).toBe(0);
  });

  test("first send creates the DM with the owner, the message referencing the copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);

    const threadId = await asAlice(t).mutation(
      api.conversation.startCopyConversation.startCopyConversation,
      { copyId: openCopy, body: "Is this still available?" },
    );

    const threads = await t.run((ctx) => ctx.db.query("threads").collect());
    expect(threads).toHaveLength(1);
    expect(threads[0].aggregateId).toBe(threadId);
    expect(threads[0].subjectKind).toBe("dm");
    expect([...threads[0].participants].sort()).toEqual([alice, bob].sort());

    const messages = await asBob(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      authorId: alice,
      body: "Is this still available?",
      copy: { copyId: openCopy, title: "Mountain Vista" },
    });
  });

  test("an existing DM is reused rather than duplicated", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);
    const existing = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );

    const threadId = await asAlice(t).mutation(
      api.conversation.startCopyConversation.startCopyConversation,
      { copyId: openCopy, body: "About this one" },
    );
    expect(threadId).toBe(existing);
    expect(await threadCount(t)).toBe(1);
  });

  test("an empty first message is rejected and leaves no empty thread behind", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);

    await expectConvexCode(
      asAlice(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId: openCopy, body: "   " },
      ),
      "EmptyMessage",
    );
    expect(await threadCount(t)).toBe(0);
  });

  test("messaging yourself about your own copy is rejected", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    await expectConvexCode(
      asBob(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId: openCopy, body: "hi me" },
      ),
      "DmRequiresTwoParticipants",
    );
    expect(await threadCount(t)).toBe(0);
  });

  test("a copy the caller may not view is rejected", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, closedCopy } = await seed(t);
    await followMutually(t, alice, bob);
    await expectConvexCode(
      asAlice(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId: closedCopy, body: "hi" },
      ),
      "CopyNotFound",
    );
    expect(await threadCount(t)).toBe(0);
  });

  test("privacy: an unconnected caller is rejected with NotConnected", async () => {
    const t = convexTest(schema, modules);
    const { openCopy } = await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId: openCopy, body: "hi" },
      ),
      "NotConnected",
    );
    expect(await threadCount(t)).toBe(0);
  });
});

describe("getThreadMessages copy reference", () => {
  test("the copy card is omitted for a reader who can no longer view the copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, openCopy } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.startCopyConversation.startCopyConversation,
      { copyId: openCopy, body: "Is this still available?" },
    );
    // Bob closes the copy: Alice may no longer view it.
    await t.run((ctx) =>
      ctx.db.patch(openCopy, {
        availability: { forTrade: false, forSale: false, forLend: false },
      }),
    );

    const messages = await asAlice(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(messages[0].copy).toBeUndefined();
  });
});
