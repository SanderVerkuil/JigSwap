import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

// Seed: alice (the actor), bob (her follower) and carol (a bystander); one approved definition.
const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      searchableText: "Mountain Vista",
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    return { alice, bob, carol, definitionId, puzzleId };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const feedOf = (t: TestConvex<typeof schema>, viewer: string) =>
  asUser(t, viewer).query(api.social.getActivityFeed.getActivityFeed, {});

const entryOf = async (
  t: TestConvex<typeof schema>,
  viewer: string,
  kind: string,
) => (await feedOf(t, viewer)).find((e) => e.kind === kind);

// One acquireCopy call; `open` lists it for trade so a non-owner may view it (canViewCopy).
const addCopy = async (
  t: TestConvex<typeof schema>,
  definitionId: string,
  open: boolean,
) => {
  const copyId = await asUser(t, "alice").mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: definitionId, condition: "good" },
  );
  if (open) {
    await asUser(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible", forTrade: true },
    );
  }
  return copyId;
};

// The copy's doc _id (what the copy route parses) from its Library aggregateId.
const copyDocId = (t: TestConvex<typeof schema>, aggregateId: string) =>
  t.run(async (ctx) => {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    return copy!._id as string;
  });

const recordSolve = (t: TestConvex<typeof schema>, copyId: string) =>
  asUser(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
    copyId,
    startDate: Date.now() - 2 * HOUR,
    endDate: Date.now() - HOUR,
  });

const follow = (
  t: TestConvex<typeof schema>,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: Date.now(),
    });
  });

const setVisibility = (
  t: TestConvex<typeof schema>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      visibility,
      updatedAt: Date.now(),
    });
  });

describe("social.getActivityFeed — link targets", () => {
  test("an acquisition links to the copy page: 'copy' for a follower, 'myCopy' for the owner", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, true);
    const id = await copyDocId(t, copyId);

    expect((await entryOf(t, "bob", "acquisition"))?.target).toEqual({
      kind: "copy",
      id,
    });
    expect((await entryOf(t, "alice", "acquisition"))?.target).toEqual({
      kind: "myCopy",
      id,
    });
  });

  test("a hidden copy yields no copy target for a follower (the entry is not shown at all)", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await addCopy(t, definitionId, false);

    expect(await entryOf(t, "bob", "acquisition")).toBeUndefined();
    expect((await entryOf(t, "alice", "acquisition"))?.target?.kind).toBe(
      "myCopy",
    );
  });

  test("a batch links to the actor's profile puzzles", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    await asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
      items: [{ puzzleDefinitionId: definitionId, forTrade: true }],
    });

    expect((await entryOf(t, "bob", "acquisitionBatch"))?.target).toEqual({
      kind: "memberPuzzles",
      handle: alice as string,
    });
  });

  test("a completion on a hidden copy links a follower to the definition, the owner to the copy", async () => {
    const t = convexTest(schema, modules);
    const { definitionId, puzzleId } = await seed(t);
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);

    expect((await entryOf(t, "bob", "completion"))?.target).toEqual({
      kind: "definition",
      id: puzzleId as string,
    });
    expect((await entryOf(t, "alice", "completion"))?.target).toEqual({
      kind: "myCopy",
      id: await copyDocId(t, copyId),
    });
  });

  test("a completion on a viewable copy links a follower to the copy", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, true);
    await recordSolve(t, copyId);

    expect((await entryOf(t, "bob", "completion"))?.target).toEqual({
      kind: "copy",
      id: await copyDocId(t, copyId),
    });
  });

  test("a private actor's completion is not shown to a one-way follower, but links the copy once mutual", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, definitionId } = await seed(t);
    await setVisibility(t, alice, "private");
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);

    // SEC-43: mutuality is what unlocks a private member's content, entries included.
    expect(await entryOf(t, "bob", "completion")).toBeUndefined();

    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: alice,
        followeeId: bob,
        createdAt: Date.now(),
      });
    });
    // Mutual followers see the whole library (canViewCopy rule 6), so the closed copy itself is
    // linked, not just its definition.
    expect((await entryOf(t, "bob", "completion"))?.target).toEqual({
      kind: "copy",
      id: await copyDocId(t, copyId),
    });
  });

  test("an exchange links a party to their trades and gives a non-party follower no target", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, puzzleId } = await seed(t);
    // carol follows alice but is not a party; alice and bob trade.
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: carol,
        followeeId: alice,
        createdAt: Date.now(),
      });
      const bob = (await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_bob"))
        .unique())!._id;
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-1",
        initiatorId: alice,
        recipientId: bob,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("domainEvents", {
        name: "ExchangeCompleted",
        payload: { exchangeId: "exch-1" },
        occurredAt: Date.now(),
        context: "exchange",
      });
    });

    for (const party of ["alice", "bob"]) {
      expect((await entryOf(t, party, "exchange"))?.target).toEqual({
        kind: "trades",
      });
    }
    const seenByCarol = await entryOf(t, "carol", "exchange");
    expect(seenByCarol).toBeDefined();
    expect(seenByCarol?.target).toBeUndefined();
    expect(seenByCarol?.actor).toEqual({ handle: alice as string });
  });

  test("the actor link is present for an active member and absent once they are deactivated", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    await addCopy(t, definitionId, true);

    expect((await entryOf(t, "bob", "acquisition"))?.actor).toEqual({
      handle: alice as string,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(alice, { isActive: false });
    });
    const entry = await entryOf(t, "bob", "acquisition");
    expect(entry).toBeDefined();
    expect(entry?.actor).toBeUndefined();
  });
});

// SEC-43: every feed entry of another member needs the profile-content unlock (canSeeProfileContent:
// a public profile or mutual followers), as acquisitions already did. The gate runs before an
// exchange's two party entries are deduplicated, so a viewer's own trade with a private member they
// follow one way still shows, as the viewer's entry.
describe("social.getActivityFeed — private actors (SEC-43)", () => {
  const seedExchange = (
    t: TestConvex<typeof schema>,
    puzzleId: Id<"puzzles">,
    initiatorId: Id<"users">,
    recipientId: Id<"users">,
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: recipientId,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-1",
        initiatorId,
        recipientId,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("domainEvents", {
        name: "ExchangeCompleted",
        payload: { exchangeId: "exch-1" },
        occurredAt: now,
        context: "exchange",
      });
    });

  test("a private actor's exchange is hidden from a one-way follower and shown once mutual", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    await setVisibility(t, alice, "private");
    await follow(t, carol, alice);
    await seedExchange(t, puzzleId, alice, bob);

    expect(await entryOf(t, "carol", "exchange")).toBeUndefined();

    await follow(t, alice, carol);
    expect((await entryOf(t, "carol", "exchange"))?.memberId).toBe(alice);
  });

  test.each([
    ["initiator", true],
    ["recipient", false],
  ])(
    "the viewer's own exchange with a private member they follow one way still shows (private %s)",
    async (_, privateInitiates) => {
      const t = convexTest(schema, modules);
      const { alice, bob, puzzleId } = await seed(t);
      // bob follows alice one way (seed); alice is private. Whichever party entry the (kind, ref)
      // dedupe keeps, dropping alice's only after it would lose bob's own entry too.
      await setVisibility(t, alice, "private");
      if (privateInitiates) await seedExchange(t, puzzleId, alice, bob);
      else await seedExchange(t, puzzleId, bob, alice);

      const mine = (await feedOf(t, "bob")).filter(
        (e) => e.kind === "exchange",
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].memberId).toBe(bob);
      expect(mine[0].target).toEqual({ kind: "trades" });
    },
  );

  test("a public actor's completion still reaches a one-way follower", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    await setVisibility(t, alice, "public");
    await recordSolve(t, await addCopy(t, definitionId, true));

    expect((await entryOf(t, "bob", "completion"))?.memberId).toBe(alice);
  });
});
