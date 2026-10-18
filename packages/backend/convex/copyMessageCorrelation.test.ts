import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// #154: the copy page's "Message" action must not let a viewer tie two copies to one hidden
// (anonymous-to-them) owner. Every DM is one-per-pair, so landing on it from a copy would reveal
// "these copies share an owner" (same threadId, same inbox row). While the owner projects as
// anonymous, getCopyConversation returns one constant status and startCopyConversation refuses.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        username: `${clerkId}_handle`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const viewer = await mkUser("clerk_viewer");
    const hidden = await mkUser("clerk_hidden");
    const other = await mkUser("clerk_other");
    const pub = await mkUser("clerk_public");
    for (const memberId of [hidden, other]) {
      await ctx.db.insert("profiles", {
        memberId,
        visibility: "private",
        updatedAt: now,
      });
    }
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: pub,
      createdAt: now,
      updatedAt: now,
    });
    // Closed copies the viewer may view only because they hold them (heldBy).
    const mkCopy = (ownerId: Id<"users">, heldBy?: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        ...(heldBy ? { heldBy } : {}),
        createdAt: now,
        updatedAt: now,
      });
    const hiddenA = await mkCopy(hidden, viewer);
    const hiddenB = await mkCopy(hidden, viewer);
    const otherC = await mkCopy(other, viewer);
    // Public owner (no profile row), open copy: the normal flow applies.
    const publicCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: pub,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { viewer, hidden, other, pub, hiddenA, hiddenB, otherC, publicCopy };
  });

const asViewer = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_viewer" });

const seedDm = (t: TestConvex<typeof schema>, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    const aggregateId = crypto.randomUUID();
    await ctx.db.insert("threads", {
      aggregateId,
      subjectKind: "dm",
      participants: [a, b],
      participantsKey: [a, b].sort().join("|"),
      readReceipts: [],
      createdAt: Date.now(),
    });
    for (const memberId of [a, b]) {
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: aggregateId,
        memberId,
      });
    }
    return aggregateId;
  });

const threadCount = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => (await ctx.db.query("threads").collect()).length);

const messageCount = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => (await ctx.db.query("threadMessages").collect()).length);

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

const getView = (t: TestConvex<typeof schema>, copyId: Id<"ownedPuzzles">) =>
  asViewer(t).query(api.conversation.getCopyConversation.getCopyConversation, {
    copyId,
  });

describe("copy-page messaging with an anonymous owner (#154)", () => {
  test("two copies of the same hidden owner yield identical payloads with no owner or thread id", async () => {
    const t = convexTest(schema, modules);
    const { hidden, other, hiddenA, hiddenB, otherC } = await seed(t);

    const a = await getView(t, hiddenA);
    const b = await getView(t, hiddenB);
    const c = await getView(t, otherC);

    expect(a).toEqual({ status: "ownerHidden" });
    // Same owner vs different owners is indistinguishable.
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    for (const payload of [a, b, c]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(hidden);
      expect(json).not.toContain(other);
      expect(json).not.toContain("clerk_hidden");
      expect(json).not.toContain("threadId");
      expect(json).not.toContain("anonRef");
    }
    expect(await threadCount(t)).toBe(0);
  });

  test("an existing DM with the hidden owner does not surface via the copy page", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden, hiddenA, hiddenB, otherC } = await seed(t);
    const dmId = await seedDm(t, viewer, hidden);

    const a = await getView(t, hiddenA);
    const b = await getView(t, hiddenB);
    const c = await getView(t, otherC);
    expect(a).toEqual({ status: "ownerHidden" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(JSON.stringify([a, b])).not.toContain(dmId);
  });

  test("startCopyConversation is refused for either copy and creates no thread", async () => {
    const t = convexTest(schema, modules);
    const { hiddenA, hiddenB } = await seed(t);

    for (const copyId of [hiddenA, hiddenB]) {
      await expectConvexCode(
        asViewer(t).mutation(
          api.conversation.startCopyConversation.startCopyConversation,
          { copyId, body: "Hi" },
        ),
        "NotConnected",
      );
    }
    expect(await threadCount(t)).toBe(0);
    expect(await messageCount(t)).toBe(0);
  });

  test("startCopyConversation is refused even when a DM with the hidden owner exists", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden, hiddenA } = await seed(t);
    await seedDm(t, viewer, hidden);

    await expectConvexCode(
      asViewer(t).mutation(
        api.conversation.startCopyConversation.startCopyConversation,
        { copyId: hiddenA, body: "Hi" },
      ),
      "NotConnected",
    );
    expect(await threadCount(t)).toBe(1);
    expect(await messageCount(t)).toBe(0);
  });

  test("control: a public owner keeps the normal new/existing flow", async () => {
    const t = convexTest(schema, modules);
    const { viewer, pub, publicCopy } = await seed(t);

    const before = await getView(t, publicCopy);
    expect(before.status).toBe("new");
    if (before.status === "new") expect(before.owner.anonymous).toBe(false);

    const dmId = await seedDm(t, viewer, pub);
    expect(await getView(t, publicCopy)).toEqual({
      status: "existing",
      threadId: dmId,
    });
    const threadId = await asViewer(t).mutation(
      api.conversation.startCopyConversation.startCopyConversation,
      { copyId: publicCopy, body: "Is this still available?" },
    );
    expect(threadId).toBe(dmId);
  });
});

// Route 2 of #154: postMessage's copy attachment. Success vs CopyNotFound must not reveal whether
// an anonymous DM partner owns a copy the author can see.
describe("attaching a copy in a DM with an anonymous partner (#154)", () => {
  const post = (
    t: TestConvex<typeof schema>,
    threadId: string,
    copyId: Id<"ownedPuzzles">,
  ) =>
    asViewer(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "About this one",
      copyId,
    });

  const errorDataOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      return dataOf(e);
    }
    throw new Error("expected a rejection");
  };

  test("the partner's copy and a third party's copy are rejected identically", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden, hiddenA, otherC } = await seed(t);
    const dmId = await seedDm(t, viewer, hidden);

    const ownedByPartner = await errorDataOf(post(t, dmId, hiddenA));
    const ownedByThirdParty = await errorDataOf(post(t, dmId, otherC));

    expect(ownedByPartner).toEqual({
      code: "CopyNotFound",
      message: "Copy not found",
    });
    expect(ownedByPartner).toEqual(ownedByThirdParty);
    expect(await messageCount(t)).toBe(0);
  });

  test("the author's own copy still attaches", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden } = await seed(t);
    const dmId = await seedDm(t, viewer, hidden);
    // Open copy of the viewer (public profile): the hidden partner can view it too.
    const mine = await t.run(async (ctx) => {
      const puzzle = await ctx.db.query("puzzles").first();
      return ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle!._id,
        ownerId: viewer,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await post(t, dmId, mine);
    expect(await messageCount(t)).toBe(1);
  });

  test("control: a revealed partner's copy still attaches", async () => {
    const t = convexTest(schema, modules);
    const { viewer, pub, publicCopy } = await seed(t);
    const dmId = await seedDm(t, viewer, pub);

    await post(t, dmId, publicCopy);
    expect(await messageCount(t)).toBe(1);
  });
});
