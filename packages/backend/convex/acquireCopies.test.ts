import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const APPROVED_COUNT = 26;

// Seed two members, 26 approved definitions, and one pending submission from each member.
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
    const mkPuzzle = async (
      title: string,
      status: "approved" | "pending",
      submittedBy: Id<"users">,
    ) => {
      const aggregateId = crypto.randomUUID();
      await ctx.db.insert("puzzles", {
        aggregateId,
        title,
        pieceCount: 1000,
        searchableText: title,
        status,
        submittedBy,
        createdAt: now,
        updatedAt: now,
      });
      return aggregateId;
    };
    const approved: string[] = [];
    for (let i = 0; i < APPROVED_COUNT; i++) {
      approved.push(await mkPuzzle(`Puzzle ${i}`, "approved", bob));
    }
    const alicePending = await mkPuzzle("Hidden Cove", "pending", alice);
    const bobPending = await mkPuzzle("Northern Lights", "pending", bob);
    return { alice, bob, approved, alicePending, bobPending };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const acquireCopies = (
  t: TestConvex<typeof schema>,
  args: {
    items: { puzzleDefinitionId: string; forTrade?: boolean }[];
    condition?: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  },
) => asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, args);

const itemsOf = (ids: string[]) =>
  ids.map((id) => ({ puzzleDefinitionId: id }));

const copiesOf = (t: TestConvex<typeof schema>, ownerId: Id<"users">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect(),
  );

const acquiredEvents = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", "CopyAcquired"))
      .collect(),
  );

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

describe("library.acquireCopies", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);
    await expect(
      t.mutation(api.library.acquireCopies.acquireCopies, {
        items: itemsOf([approved[0]]),
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("adds one private, unoffered copy per definition, owned by the caller", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved, alicePending } = await seed(t);

    const { copyIds } = await acquireCopies(t, {
      items: itemsOf([approved[0], alicePending]),
    });

    expect(copyIds).toHaveLength(2);
    const rows = await copiesOf(t, alice);
    expect(rows.map((r) => r.aggregateId).sort()).toEqual([...copyIds].sort());
    const byDefinition = new Map(rows.map((r) => [r.puzzleDefinitionId, r]));
    for (const id of [approved[0], alicePending]) {
      const row = byDefinition.get(id);
      expect(row?.condition).toBe("good");
      expect(row?.visibility).toBe("private");
      expect(row?.availability).toEqual({
        forTrade: false,
        forSale: false,
        forLend: false,
      });
    }
  });

  test("applies a supplied condition to every copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved } = await seed(t);
    await acquireCopies(t, {
      items: itemsOf([approved[0], approved[1]]),
      condition: "like_new",
    });
    const rows = await copiesOf(t, alice);
    expect(rows.map((r) => r.condition)).toEqual(["like_new", "like_new"]);
  });

  test("offers only the items marked forTrade for swap", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved } = await seed(t);
    await acquireCopies(t, {
      items: [
        { puzzleDefinitionId: approved[0], forTrade: true },
        { puzzleDefinitionId: approved[1] },
        { puzzleDefinitionId: approved[2], forTrade: false },
      ],
    });
    const byDefinition = new Map(
      (await copiesOf(t, alice)).map((r) => [r.puzzleDefinitionId, r]),
    );
    expect(byDefinition.get(approved[0])?.availability).toEqual({
      forTrade: true,
      forSale: false,
      forLend: false,
    });
    expect(byDefinition.get(approved[0])?.visibility).toBe("visible");
    for (const id of [approved[1], approved[2]]) {
      expect(byDefinition.get(id)?.availability.forTrade).toBe(false);
      expect(byDefinition.get(id)?.visibility).toBe("private");
    }
  });

  test("is all or nothing: one refused definition writes no copy and no event", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved, bobPending } = await seed(t);

    await expectConvexCode(
      acquireCopies(t, {
        items: [
          { puzzleDefinitionId: approved[0], forTrade: true },
          { puzzleDefinitionId: bobPending },
        ],
      }),
      "PuzzleNotAcquirable",
    );
    await expectConvexCode(
      acquireCopies(t, {
        items: itemsOf([approved[0], crypto.randomUUID()]),
      }),
      "PuzzleNotFound",
    );

    expect(await copiesOf(t, alice)).toHaveLength(0);
    expect(await acquiredEvents(t)).toHaveLength(0);
  });

  test("accepts 25 definitions and rejects 26 without writing anything", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved } = await seed(t);

    await expectConvexCode(
      acquireCopies(t, { items: itemsOf(approved.slice(0, 26)) }),
      "AcquireBatchTooLarge",
    );
    expect(await copiesOf(t, alice)).toHaveLength(0);

    const { copyIds } = await acquireCopies(t, {
      items: itemsOf(approved.slice(0, 25)),
    });
    expect(copyIds).toHaveLength(25);
    expect(await copiesOf(t, alice)).toHaveLength(25);
  });

  test("rejects an empty batch", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      acquireCopies(t, { items: [] }),
      "EmptyAcquireBatch",
    );
  });

  test("collapses duplicate definitions into one copy each", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved } = await seed(t);
    const { copyIds } = await acquireCopies(t, {
      items: itemsOf([approved[0], approved[0], approved[1], approved[0]]),
    });
    expect(copyIds).toHaveLength(2);
    const definitions = (await copiesOf(t, alice))
      .map((r) => r.puzzleDefinitionId)
      .sort();
    expect(definitions).toEqual([approved[0], approved[1]].sort());
  });

  test("tags a batch's CopyAcquired events and copies with one batchId; a single add has none", async () => {
    const t = convexTest(schema, modules);
    const { alice, approved } = await seed(t);

    await asUser(t, "alice").mutation(api.library.acquireCopy.acquireCopy, {
      puzzleDefinitionId: approved[0],
      condition: "good",
    });
    const first = await acquireCopies(t, {
      items: itemsOf([approved[1], approved[2]]),
    });
    const second = await acquireCopies(t, { items: itemsOf([approved[3]]) });

    const events = await acquiredEvents(t);
    expect(events).toHaveLength(4);
    const batchOf = (copyId: string) =>
      events.find((e) => e.payload.copyId === copyId)?.payload.batchId;
    const firstBatch = batchOf(first.copyIds[0]);
    expect(typeof firstBatch).toBe("string");
    expect(batchOf(first.copyIds[1])).toBe(firstBatch);
    expect(batchOf(second.copyIds[0])).not.toBe(firstBatch);
    const single = events.find(
      (e) => ![...first.copyIds, ...second.copyIds].includes(e.payload.copyId),
    );
    expect(single?.payload.batchId).toBeUndefined();
    expect(single?.payload.bulk).toBeUndefined();

    const copies = await copiesOf(t, alice);
    const copyBatch = (copyId: string) =>
      copies.find((c) => c.aggregateId === copyId)?.acquisitionBatchId;
    expect(copyBatch(first.copyIds[0])).toBe(firstBatch);
    expect(copyBatch(first.copyIds[1])).toBe(firstBatch);
    expect(copyBatch(second.copyIds[0])).toBe(batchOf(second.copyIds[0]));
    expect(
      copies.filter((c) => c.acquisitionBatchId === undefined),
    ).toHaveLength(1);
  });
});
