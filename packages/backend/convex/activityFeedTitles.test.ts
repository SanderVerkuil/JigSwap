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
    await ctx.db.insert("puzzles", {
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
    return { alice, bob, carol, definitionId };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// The fields this suite is about, so an added view field never breaks the comparison.
const titleView = async (
  t: TestConvex<typeof schema>,
  viewer: string,
  kind: string,
) => {
  const feed = await asUser(t, viewer).query(
    api.social.getActivityFeed.getActivityFeed,
    {},
  );
  const entry = feed.find((e) => e.kind === kind);
  return entry
    ? {
        kind: entry.kind,
        title: entry.title,
        linked: entry.target !== undefined,
      }
    : undefined;
};

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

const recordSolve = (t: TestConvex<typeof schema>, copyId: string) =>
  asUser(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
    copyId,
    startDate: Date.now() - 2 * HOUR,
    endDate: Date.now() - HOUR,
  });

const makePrivate = (t: TestConvex<typeof schema>, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      visibility: "private",
      updatedAt: Date.now(),
    });
  });

describe("social.getActivityFeed — puzzle titles", () => {
  test("a single add names the puzzle, for the owner and for a follower who may see the copy", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await addCopy(t, definitionId, true);

    const expected = {
      kind: "acquisition",
      title: "Mountain Vista",
      linked: true,
    };
    expect(await titleView(t, "alice", "acquisition")).toEqual(expected);
    expect(await titleView(t, "bob", "acquisition")).toEqual(expected);
  });

  test("a completion names the puzzle, also when a follower only reaches its definition", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    // A closed copy: bob can't open it, so his entry links the definition instead.
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);

    const expected = {
      kind: "completion",
      title: "Mountain Vista",
      linked: true,
    };
    expect(await titleView(t, "alice", "completion")).toEqual(expected);
    expect(await titleView(t, "bob", "completion")).toEqual(expected);
  });

  test("a private actor's completion names nothing to a one-way follower", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    await makePrivate(t, alice);
    const copyId = await addCopy(t, definitionId, true);
    await recordSolve(t, copyId);

    // SEC-43: the entry itself is hidden from a one-way follower, so nothing names the puzzle.
    expect(await titleView(t, "bob", "completion")).toBeUndefined();
    // The actor still sees her own title.
    expect((await titleView(t, "alice", "completion"))?.title).toBe(
      "Mountain Vista",
    );
  });

  test("no link, no title: a solve the viewer can't open keeps only its subject", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);
    // Neither the closed copy nor the no-longer-approved definition opens for bob.
    await t.run(async (ctx) => {
      const puzzle = await ctx.db.query("puzzles").first();
      await ctx.db.patch(puzzle!._id, {
        status: "pending",
        submittedBy: alice,
      });
    });

    const feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    const entry = feed.find((e) => e.kind === "completion");
    expect(entry?.subject?.title).toBe("Mountain Vista");
    expect(entry?.target).toBeUndefined();
    expect(entry?.title).toBeUndefined();
  });

  test("a started solve names the puzzle for the solver", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, false);
    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId, startDate: Date.now() - HOUR },
    );

    expect(await titleView(t, "alice", "started")).toEqual({
      kind: "started",
      title: "Mountain Vista",
      linked: true,
    });
  });

  test("a batch add carries no title (its covers show what was added)", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
      items: [{ puzzleDefinitionId: definitionId, forTrade: true }],
    });

    const batch = await titleView(t, "bob", "acquisitionBatch");
    expect(batch?.linked).toBe(true);
    expect(batch?.title).toBeUndefined();
  });
});
