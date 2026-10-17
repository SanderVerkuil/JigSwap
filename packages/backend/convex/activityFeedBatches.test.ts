import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

// Seed: alice (the adder), bob (her follower) and 12 approved definitions; puzzle 0 has box art.
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
    const image = await ctx.storage.store(new Blob(["box art"]));
    const definitions: string[] = [];
    for (let i = 0; i < 12; i++) {
      const aggregateId = crypto.randomUUID();
      await ctx.db.insert("puzzles", {
        aggregateId,
        title: `Puzzle ${i}`,
        pieceCount: 1000,
        searchableText: `Puzzle ${i}`,
        status: "approved",
        submittedBy: bob,
        image: i === 0 ? image : undefined,
        createdAt: now,
        updatedAt: now,
      });
      definitions.push(aggregateId);
    }
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    return { alice, bob, definitions };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// forTrade makes a copy open, which a non-owner needs to see it (canViewCopy).
const addBatch = (
  t: TestConvex<typeof schema>,
  definitions: string[],
  forTrade: boolean | ((index: number) => boolean) = true,
) =>
  asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
    items: definitions.map((puzzleDefinitionId, index) => ({
      puzzleDefinitionId,
      forTrade: typeof forTrade === "function" ? forTrade(index) : forTrade,
    })),
  });

// One acquireCopy call (no batch id). A fresh copy is closed; `open` lists it for trade.
const addSingle = async (
  t: TestConvex<typeof schema>,
  puzzleDefinitionId: string,
  open: boolean,
) => {
  const copyId = await asUser(t, "alice").mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId, condition: "good" },
  );
  if (open) {
    await asUser(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible", forTrade: true },
    );
  }
  return copyId;
};

const feedOf = (t: TestConvex<typeof schema>, viewer: string) =>
  asUser(t, viewer).query(api.social.getActivityFeed.getActivityFeed, {});

const batchEntries = async (t: TestConvex<typeof schema>, viewer: string) =>
  (await feedOf(t, viewer)).filter((e) => e.kind === "acquisitionBatch");

// Move every CopyAcquired event of the given copies back in time (two calls in one test otherwise
// share a millisecond, which would make the ordering assertions meaningless).
const backdate = (
  t: TestConvex<typeof schema>,
  copyIds: string[],
  occurredAt: number,
) =>
  t.run(async (ctx) => {
    const events = await ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", "CopyAcquired"))
      .collect();
    for (const event of events) {
      const copyId = (event.payload as { copyId?: string }).copyId;
      if (copyId !== undefined && copyIds.includes(copyId)) {
        await ctx.db.patch(event._id, { occurredAt });
      }
    }
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

describe("social.getActivityFeed — grouped batch adds", () => {
  test("one batch is one grouped entry with the count and up to four covers", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);

    const { copyIds } = await addBatch(t, definitions.slice(0, 6));

    for (const viewer of ["bob", "alice"]) {
      const entries = await batchEntries(t, viewer);
      expect(entries).toHaveLength(1);
      const [entry] = entries;
      expect(entry.memberId).toBe(alice);
      expect(entry.batch?.count).toBe(6);
      // Covers follow the order the member picked them in.
      expect(entry.batch?.covers.map((c) => c.copyId)).toEqual(
        copyIds.slice(0, 4),
      );
      expect(entry.batch?.covers[0].title).toBe("Puzzle 0");
      expect(entry.batch?.covers[0].coverUrl).toEqual(expect.any(String));
      expect(entry.batch?.covers[1].coverUrl).toBeNull();
      // No per-copy entries for the batch.
      const feed = await feedOf(t, viewer);
      expect(feed.filter((e) => e.kind === "acquisition")).toHaveLength(0);
    }
  });

  test("single adds stay separate entries next to a batch", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    const single = await asUser(t, "alice").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: definitions[0], condition: "good" },
    );
    await addBatch(t, definitions.slice(1, 4));

    const feed = await feedOf(t, "alice");
    const singles = feed.filter((e) => e.kind === "acquisition");
    expect(singles.map((e) => e.ref)).toEqual([single]);
    expect(singles[0].batch).toBeUndefined();
    expect(feed.filter((e) => e.kind === "acquisitionBatch")).toHaveLength(1);
  });

  test("two batches are two entries, each at its batch time, newest first", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    const older = await addBatch(t, definitions.slice(0, 2));
    const newer = await addBatch(t, definitions.slice(2, 5));
    const olderAt = Date.now() - 3 * HOUR;
    const newerAt = Date.now() - HOUR;
    await backdate(t, older.copyIds, olderAt);
    await backdate(t, newer.copyIds, newerAt);
    // A single add between the two batches sorts between them (open, so bob may see it).
    const single = await addSingle(t, definitions[5], true);
    const singleAt = Date.now() - 2 * HOUR;
    await backdate(t, [single], singleAt);

    const feed = (await feedOf(t, "bob")).filter((e) =>
      ["acquisition", "acquisitionBatch"].includes(e.kind),
    );
    expect(feed.map((e) => [e.kind, e.batch?.count, e.occurredAt])).toEqual([
      ["acquisitionBatch", 3, newerAt],
      ["acquisition", undefined, singleAt],
      ["acquisitionBatch", 2, olderAt],
    ]);
    expect(feed[0].ref).not.toBe(feed[2].ref);
  });

  test("a follower counts and sees covers only for the copies they can view", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    // Only the first two of five are open (forTrade); closed copies are owner-only.
    const { copyIds } = await addBatch(
      t,
      definitions.slice(0, 5),
      (index) => index < 2,
    );

    const [mine] = await batchEntries(t, "alice");
    expect(mine.batch?.count).toBe(5);

    const [theirs] = await batchEntries(t, "bob");
    expect(theirs.batch?.count).toBe(2);
    expect(theirs.batch?.covers.map((c) => c.copyId)).toEqual(
      copyIds.slice(0, 2),
    );
  });

  test("a batch the follower can see none of is dropped, without shortening the page", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    await addBatch(t, definitions.slice(0, 3), false);

    expect(await batchEntries(t, "bob")).toHaveLength(0);
    expect(await batchEntries(t, "alice")).toHaveLength(1);
  });

  test("a private profile hides the batch from a one-way follower", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    await setVisibility(t, alice, "private");

    await addBatch(t, definitions.slice(0, 3));

    expect(await batchEntries(t, "bob")).toHaveLength(0);
    expect((await batchEntries(t, "alice"))[0].batch?.count).toBe(3);
  });

  test("a deleted copy no longer counts toward its batch", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    const { copyIds } = await addBatch(t, definitions.slice(0, 3));
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyIds[0]))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });

    const [entry] = await batchEntries(t, "bob");
    expect(entry.batch?.count).toBe(2);
    expect(entry.batch?.covers.map((c) => c.copyId)).toEqual(copyIds.slice(1));
  });
});

describe("social.getActivityFeed — single adds respect copy visibility", () => {
  const singleRefs = async (t: TestConvex<typeof schema>, viewer: string) =>
    (await feedOf(t, viewer))
      .filter((e) => e.kind === "acquisition")
      .map((e) => e.ref);

  test("a follower does not see a single add of a copy they cannot view", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    const closed = await addSingle(t, definitions[0], false);

    expect(await singleRefs(t, "bob")).toEqual([]);
    expect(await singleRefs(t, "alice")).toEqual([closed]);
  });

  test("a follower sees a single add of a copy they can view", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    const open = await addSingle(t, definitions[0], true);
    const closed = await addSingle(t, definitions[1], false);

    expect(await singleRefs(t, "bob")).toEqual([open]);
    expect((await singleRefs(t, "alice")).sort()).toEqual(
      [open, closed].sort(),
    );
  });

  test("a private profile hides even an open single add from a one-way follower", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    await setVisibility(t, alice, "private");

    const open = await addSingle(t, definitions[0], true);

    expect(await singleRefs(t, "bob")).toEqual([]);
    expect(await singleRefs(t, "alice")).toEqual([open]);
  });

  test("the member holding a closed copy still sees its single add", async () => {
    const t = convexTest(schema, modules);
    const { bob, definitions } = await seed(t);

    const closed = await addSingle(t, definitions[0], false);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", closed))
        .unique();
      if (row) await ctx.db.patch(row._id, { heldBy: bob });
    });

    expect(await singleRefs(t, "bob")).toEqual([closed]);
  });
});
