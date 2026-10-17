import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Message-center header read model: the inbox's `contextCopy` ("Go to puzzle") and the DM
// subject's `profileHandle` ("Go to profile"), plus getThreadMessages' `copyUnavailable` flag.
// Every field is gated server-side for the VIEWER — a copy they may not view, or a member who is
// anonymised to them, never surfaces.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const CLOSED = { forTrade: false, forSale: false, forLend: false };

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
    const mkCopy = async (title: string) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title,
        pieceCount: 1000,
        status: "approved",
        submittedBy: bob,
        createdAt: now,
        updatedAt: now,
      });
      // Bob's profile is public (no row) and the copy is open: anyone may view it.
      return ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    };
    const first = await mkCopy("First Puzzle");
    const second = await mkCopy("Second Puzzle");
    return { alice, bob, first, second };
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

// Keep message sentAt instants strictly increasing.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const flushScheduled = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const closeCopy = (t: TestConvex<typeof schema>, copy: Id<"ownedPuzzles">) =>
  t.run((ctx) => ctx.db.patch(copy, { availability: CLOSED }));

const makePrivate = (t: TestConvex<typeof schema>, member: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("profiles", {
      memberId: member,
      visibility: "private",
      updatedAt: Date.now(),
    }),
  );

const inboxOf = (viewer: ReturnType<typeof asAlice>) =>
  viewer.query(api.conversation.getMyInbox.getMyInbox, {});

// Alice messages Bob about `first`, then (same DM) about `second`.
const dmAboutBoth = async (
  t: TestConvex<typeof schema>,
  first: Id<"ownedPuzzles">,
  second: Id<"ownedPuzzles">,
) => {
  const threadId = await asAlice(t).mutation(
    api.conversation.startCopyConversation.startCopyConversation,
    { copyId: first, body: "About the first" },
  );
  await tick();
  await asAlice(t).mutation(
    api.conversation.startCopyConversation.startCopyConversation,
    { copyId: second, body: "And the second" },
  );
  await tick();
  await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "plain follow-up",
  });
  return threadId;
};

describe("getMyInbox contextCopy", () => {
  test("a DM without copy references has no context copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: bob,
    });
    const [row] = await inboxOf(asAlice(t));
    expect(row.contextCopy).toBeNull();
  });

  test("picks the most recently referenced viewable copy, past plain messages", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    await followMutually(t, alice, bob);
    await dmAboutBoth(t, first, second);

    for (const viewer of [asAlice(t), asBob(t)]) {
      const [row] = await inboxOf(viewer);
      expect(row.contextCopy).toEqual({
        copyId: second,
        title: "Second Puzzle",
      });
    }
  });

  test("skips a copy the viewer can no longer view; null when none is viewable", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    await followMutually(t, alice, bob);
    await dmAboutBoth(t, first, second);

    await closeCopy(t, second);
    expect((await inboxOf(asAlice(t)))[0].contextCopy).toEqual({
      copyId: first,
      title: "First Puzzle",
    });
    // Per viewer: the owner still sees their own closed copy.
    expect((await inboxOf(asBob(t)))[0].contextCopy?.copyId).toBe(second);

    await closeCopy(t, first);
    expect((await inboxOf(asAlice(t)))[0].contextCopy).toBeNull();
  });

  test("a deleted copy is skipped", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    await followMutually(t, alice, bob);
    await dmAboutBoth(t, first, second);
    await t.run((ctx) => ctx.db.delete(second));
    expect((await inboxOf(asBob(t)))[0].contextCopy?.copyId).toBe(first);
  });

  test("an exchange thread's context copy is the requested copy, only while viewable", async () => {
    const t = convexTest(schema, modules);
    const { bob, first } = await seed(t);
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: first,
      salePrice: 1000,
    });
    await flushScheduled(t);

    for (const viewer of [asAlice(t), asBob(t)]) {
      expect((await inboxOf(viewer))[0].contextCopy).toEqual({
        copyId: first,
        title: "First Puzzle",
      });
    }

    // Bob goes private and Alice is no mutual follower: she may no longer view the copy.
    await makePrivate(t, bob);
    expect((await inboxOf(asAlice(t)))[0].contextCopy).toBeNull();
    expect((await inboxOf(asBob(t)))[0].contextCopy?.copyId).toBe(first);
  });
});

describe("getMyInbox DM profileHandle", () => {
  const dmSubjectOf = async (viewer: ReturnType<typeof asAlice>) => {
    const [row] = await inboxOf(viewer);
    if (row.subject.kind !== "dm") throw new Error("expected a dm subject");
    return row.subject;
  };

  const openDm = async (t: TestConvex<typeof schema>, bob: Id<"users">) =>
    asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: bob,
    });

  test("slug, then username, then member id — the web's /members/<handle> order", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await openDm(t, bob);

    expect((await dmSubjectOf(asAlice(t))).profileHandle).toBe(bob);
    await t.run((ctx) => ctx.db.patch(bob, { username: "bobby" }));
    expect((await dmSubjectOf(asAlice(t))).profileHandle).toBe("bobby");
    await t.run((ctx) => ctx.db.patch(bob, { slug: "bob-puzzles" }));
    expect((await dmSubjectOf(asAlice(t))).profileHandle).toBe("bob-puzzles");
  });

  test("a private mutual follower is revealed and linkable", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await openDm(t, bob);
    await makePrivate(t, bob);
    expect((await dmSubjectOf(asAlice(t))).profileHandle).toBe(bob);
  });

  test("null when the other member is anonymised (private, no longer mutual)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await openDm(t, bob);
    await makePrivate(t, bob);
    await t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", alice).eq("followeeId", bob),
        )
        .unique();
      if (edge) await ctx.db.delete(edge._id);
    });

    const subject = await dmSubjectOf(asAlice(t));
    expect(subject.otherMember.anonymous).toBe(true);
    expect(subject.profileHandle).toBeNull();
  });

  test("null when the other member's account is inactive", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await openDm(t, bob);
    await t.run((ctx) => ctx.db.patch(bob, { isActive: false }));
    expect((await dmSubjectOf(asAlice(t))).profileHandle).toBeNull();
  });
});

describe("getThreadMessages copyUnavailable", () => {
  const firstMessage = async (t: TestConvex<typeof schema>, threadId: string) =>
    (
      await asAlice(t).query(
        api.conversation.getThreadMessages.getThreadMessages,
        { threadId },
      )
    )[0];

  const startAbout = async (
    t: TestConvex<typeof schema>,
    copy: Id<"ownedPuzzles">,
  ) =>
    asAlice(t).mutation(
      api.conversation.startCopyConversation.startCopyConversation,
      { copyId: copy, body: "Is this still available?" },
    );

  test("absent while the copy is viewable", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await startAbout(t, first);
    const message = await firstMessage(t, threadId);
    expect(message.copy?.copyId).toBe(first);
    expect(message.copyUnavailable).toBeUndefined();
  });

  test("set, with no card, once the copy becomes unviewable", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await startAbout(t, first);
    await closeCopy(t, first);
    const message = await firstMessage(t, threadId);
    expect(message.copy).toBeUndefined();
    expect(message.copyUnavailable).toBe(true);
  });

  test("set once the copy is deleted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await startAbout(t, first);
    await t.run((ctx) => ctx.db.delete(first));
    const message = await firstMessage(t, threadId);
    expect(message.copy).toBeUndefined();
    expect(message.copyUnavailable).toBe(true);
  });

  test("never set on a message without a copy reference", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "hi",
    });
    const message = await firstMessage(t, threadId);
    expect(message).not.toHaveProperty("copyUnavailable");
    expect(message).not.toHaveProperty("copy");
  });
});
