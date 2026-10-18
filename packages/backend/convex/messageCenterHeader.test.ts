import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Message-center header read model: the inbox's `contextCopies` (puzzle menu / cover stack) and
// the subjects' `otherMember` + `profileHandle` ("Go to profile"), plus getThreadMessages' `copyUnavailable` flag.
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

// Fake timers throughout: posting schedules async jobs (event dispatch, notification delivery),
// and on real timers those could fire after a test ends and leak into later tests. Jobs only run
// where a test drains them (flushScheduled); useRealTimers drops the rest.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Keep message sentAt instants strictly increasing — moves the faked clock without firing timers.
const tick = async () => {
  vi.setSystemTime(Date.now() + 5);
};

const flushScheduled = (t: TestConvex<typeof schema>) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

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

// Extra open copies owned by `owner` (public profile -> viewable by anyone), oldest first.
const mkOpenCopies = (
  t: TestConvex<typeof schema>,
  owner: Id<"users">,
  titles: string[],
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"ownedPuzzles">[] = [];
    for (const title of titles) {
      const puzzleId = await ctx.db.insert("puzzles", {
        title,
        pieceCount: 500,
        status: "approved",
        submittedBy: owner,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: true, forSale: false, forLend: false },
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return ids;
  });

// Append message rows straight into the read-model table (the projection getMyInbox reads), in
// order, each strictly newer than everything already in the thread. `null` = a plain message.
const appendMessages = (
  t: TestConvex<typeof schema>,
  threadId: string,
  author: Id<"users">,
  copyIds: (Id<"ownedPuzzles"> | null)[],
) =>
  t.run(async (ctx) => {
    const newest = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
      .order("desc")
      .first();
    let sentAt = Math.max(newest?.sentAt ?? 0, Date.now());
    for (const [i, copyId] of copyIds.entries()) {
      sentAt += 1;
      await ctx.db.insert("threadMessages", {
        threadAggregateId: threadId,
        messageId: `seeded-${sentAt}-${i}`,
        authorId: author,
        kind: "text",
        body: copyId ? "about a puzzle" : "chatter",
        sentAt,
        ...(copyId ? { copyId } : {}),
      });
    }
  });

const contextIdsOf = async (viewer: ReturnType<typeof asAlice>) =>
  (await inboxOf(viewer))[0].contextCopies.map((c) => c.copyId);

const openAliceBobDm = async (
  t: TestConvex<typeof schema>,
  alice: Id<"users">,
  bob: Id<"users">,
) => {
  await followMutually(t, alice, bob);
  return asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId: bob,
  });
};

describe("getMyInbox contextCopies", () => {
  test("a DM without copy references has no context copies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    await asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: bob,
    });
    expect(await contextIdsOf(asAlice(t))).toEqual([]);
  });

  test("distinct referenced copies, newest reference first, with the full card", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await dmAboutBoth(t, first, second);
    // `first` referenced again most recently: it moves to the front, listed once.
    await appendMessages(t, threadId, alice, [first, null]);

    for (const viewer of [asAlice(t), asBob(t)]) {
      const [row] = await inboxOf(viewer);
      expect(row.contextCopies.map((c) => c.copyId)).toEqual([first, second]);
      expect(row.contextCopies[0]).toMatchObject({
        copyId: first,
        title: "First Puzzle",
        pieceCount: 1000,
        coverUrl: null,
      });
    }
  });

  test("skips copies the viewer can no longer view (per viewer) and deleted copies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    await followMutually(t, alice, bob);
    await dmAboutBoth(t, first, second);

    await closeCopy(t, second);
    expect(await contextIdsOf(asAlice(t))).toEqual([first]);
    // The owner still sees their own closed copy.
    expect(await contextIdsOf(asBob(t))).toEqual([second, first]);

    await t.run((ctx) => ctx.db.delete(first));
    expect(await contextIdsOf(asAlice(t))).toEqual([]);
    expect(await contextIdsOf(asBob(t))).toEqual([second]);
  });

  test("newest reference first across interleaved references, not index (copyId) order", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openAliceBobDm(t, alice, bob);
    const [c0, c1, c2, c3] = await mkOpenCopies(t, bob, [
      "C0",
      "C1",
      "C2",
      "C3",
    ]);
    await appendMessages(t, threadId, alice, [
      c0,
      null,
      c1,
      c2,
      null,
      c0,
      c3,
      null,
      c1,
      null,
    ]);
    expect(await contextIdsOf(asAlice(t))).toEqual([c1, c3, c0, c2]);
  });

  test("capped at the 10 most recently referenced distinct copies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openAliceBobDm(t, alice, bob);
    const copies = await mkOpenCopies(
      t,
      bob,
      Array.from({ length: 12 }, (_, i) => `Copy ${i}`),
    );
    // Referenced in both id orders so neither the newest nor the oldest ids alone pass.
    await appendMessages(t, threadId, alice, copies);
    expect(await contextIdsOf(asAlice(t))).toEqual(copies.slice(2).reverse());
    await appendMessages(t, threadId, alice, [...copies].reverse());
    expect(await contextIdsOf(asAlice(t))).toEqual(copies.slice(0, 10));
  });

  test("plain messages neither hide nor bound references: one far back in a long thread is found", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    const threadId = await openAliceBobDm(t, alice, bob);
    await appendMessages(t, threadId, alice, [
      first,
      ...Array.from({ length: 1000 }, () => null),
      second,
      ...Array.from({ length: 600 }, () => null),
    ]);
    expect(await contextIdsOf(asAlice(t))).toEqual([second, first]);
    // lastMessage still reads the newest message, copy or not.
    expect((await inboxOf(asAlice(t)))[0].lastMessage?.body).toBe("chatter");
  });

  test("exchange: requested then offered copy first, deduped against message references", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first, second } = await seed(t);
    const [aliceCopy] = await mkOpenCopies(t, alice, ["Alice's Offer"]);
    await t.run((ctx) =>
      ctx.db.patch(first, {
        availability: { forTrade: true, forSale: false, forLend: false },
      }),
    );
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: first,
      offeredPuzzleId: aliceCopy,
    });
    await flushScheduled(t);
    const [row] = await inboxOf(asAlice(t));
    expect(row.subject.kind).toBe("exchange");
    // Messages referencing the requested copy again plus another one.
    await appendMessages(t, row.threadId, alice, [second, first]);

    for (const viewer of [asAlice(t), asBob(t)]) {
      expect(await contextIdsOf(viewer)).toEqual([first, aliceCopy, second]);
    }

    // Bob goes private and Alice is no mutual follower: his copies drop out for her only.
    await makePrivate(t, bob);
    expect(await contextIdsOf(asAlice(t))).toEqual([aliceCopy]);
    expect(await contextIdsOf(asBob(t))).toEqual([first, aliceCopy, second]);
  });
});

describe("getMyInbox contextCopies owner", () => {
  test("DM: `viewer` for the caller's own copy, `other` for the partner's — from both sides", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    const threadId = await openAliceBobDm(t, alice, bob);
    const [aliceCopy] = await mkOpenCopies(t, alice, ["Alice's Copy"]);
    await appendMessages(t, threadId, alice, [first, aliceCopy]);

    const ownersFor = async (viewer: ReturnType<typeof asAlice>) =>
      (await inboxOf(viewer))[0].contextCopies.map((c) => [c.copyId, c.owner]);
    expect(await ownersFor(asAlice(t))).toEqual([
      [aliceCopy, "viewer"],
      [first, "other"],
    ]);
    expect(await ownersFor(asBob(t))).toEqual([
      [aliceCopy, "other"],
      [first, "viewer"],
    ]);
  });

  test("exchange: the offered and requested copies are labelled per viewer", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    const [aliceCopy] = await mkOpenCopies(t, alice, ["Alice's Offer"]);
    await t.run((ctx) =>
      ctx.db.patch(first, {
        availability: { forTrade: true, forSale: false, forLend: false },
      }),
    );
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: first,
      offeredPuzzleId: aliceCopy,
    });
    await flushScheduled(t);

    const forAlice = (await inboxOf(asAlice(t)))[0].contextCopies;
    expect(forAlice.map((c) => c.owner)).toEqual(["other", "viewer"]);
    const forBob = (await inboxOf(asBob(t)))[0].contextCopies;
    expect(forBob.map((c) => c.owner)).toEqual(["viewer", "other"]);
  });

  test("a legacy reference to a third party's copy is left out, even when viewable", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    const threadId = await openAliceBobDm(t, alice, bob);
    const carol = await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "clerk_carol",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const [carolCopy] = await mkOpenCopies(t, carol, ["Carol's Copy"]);
    await appendMessages(t, threadId, alice, [first, carolCopy]);
    expect(await contextIdsOf(asAlice(t))).toEqual([first]);
    expect(await contextIdsOf(asBob(t))).toEqual([first]);
  });
});

describe("getMyInbox exchange counterparty", () => {
  const exchangeSubjectOf = async (viewer: ReturnType<typeof asAlice>) => {
    const [row] = await inboxOf(viewer);
    if (row.subject.kind !== "exchange")
      throw new Error("expected an exchange subject");
    return row.subject;
  };

  const propose = async (
    t: TestConvex<typeof schema>,
    bob: Id<"users">,
    copy: Id<"ownedPuzzles">,
  ) => {
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await flushScheduled(t);
  };

  test("each side sees the other party, revealed with a profile handle", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    await propose(t, bob, first);
    await t.run((ctx) => ctx.db.patch(bob, { username: "bobby" }));

    const forAlice = await exchangeSubjectOf(asAlice(t));
    expect(forAlice.otherMember.anonymous).toBe(false);
    if (!forAlice.otherMember.anonymous)
      expect(forAlice.otherMember.member._id).toBe(bob);
    expect(forAlice.profileHandle).toBe("bobby");

    const forBob = await exchangeSubjectOf(asBob(t));
    if (forBob.otherMember.anonymous) throw new Error("expected revealed");
    expect(forBob.otherMember.member._id).toBe(alice);
    expect(forBob.profileHandle).toBe(alice);
  });

  test("an anonymised partner has no handle", async () => {
    const t = convexTest(schema, modules);
    const { bob, first } = await seed(t);
    await propose(t, bob, first);
    await makePrivate(t, bob);

    const subject = await exchangeSubjectOf(asAlice(t));
    expect(subject.otherMember.anonymous).toBe(true);
    expect(subject.profileHandle).toBeNull();
  });

  test("an inactive partner has no handle", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, first } = await seed(t);
    await propose(t, bob, first);
    await t.run((ctx) => ctx.db.patch(alice, { isActive: false }));
    expect((await exchangeSubjectOf(asBob(t))).profileHandle).toBeNull();
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
