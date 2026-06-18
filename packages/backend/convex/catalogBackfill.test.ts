import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedSubmitter = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const insertPuzzle = (
  t: ReturnType<typeof convexTest>,
  submittedBy: Id<"users">,
  fields: { title: string; aggregateId?: string },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("puzzles", {
      title: fields.title,
      pieceCount: 1000,
      searchableText: fields.title,
      status: "approved",
      submittedBy,
      createdAt: now,
      updatedAt: now,
      ...(fields.aggregateId ? { aggregateId: fields.aggregateId } : {}),
    });
  });

const puzzleById = (t: ReturnType<typeof convexTest>, id: Id<"puzzles">) =>
  t.run(async (ctx) => ctx.db.get(id));

const puzzleByAggregateId = (
  t: ReturnType<typeof convexTest>,
  aggregateId: string,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

describe("catalog.backfillPuzzleAggregateIds", () => {
  test("stamps each legacy puzzle's _id as its aggregateId and leaves stamped rows alone", async () => {
    const t = convexTest(schema, modules);
    const submitter = await seedSubmitter(t);
    const legacyA = await insertPuzzle(t, submitter, { title: "Legacy A" });
    const legacyB = await insertPuzzle(t, submitter, { title: "Legacy B" });
    const alreadyStamped = await insertPuzzle(t, submitter, {
      title: "Domain Puzzle",
      aggregateId: "existing-uuid",
    });

    const result = await t.mutation(
      internal.catalog.backfill.backfillPuzzleAggregateIds,
      {},
    );
    expect(result.patched).toBe(2);

    // Legacy rows now carry their own _id as the aggregateId...
    expect((await puzzleById(t, legacyA))?.aggregateId).toBe(legacyA);
    expect((await puzzleById(t, legacyB))?.aggregateId).toBe(legacyB);
    // ...so they are now resolvable through the by_aggregate_id index the copy flow uses.
    expect((await puzzleByAggregateId(t, legacyA))?._id).toBe(legacyA);

    // A row that already had an aggregateId is untouched.
    expect((await puzzleById(t, alreadyStamped))?.aggregateId).toBe(
      "existing-uuid",
    );
  });

  test("is idempotent — a second run stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const submitter = await seedSubmitter(t);
    await insertPuzzle(t, submitter, { title: "Legacy A" });

    const first = await t.mutation(
      internal.catalog.backfill.backfillPuzzleAggregateIds,
      {},
    );
    expect(first.patched).toBe(1);

    const second = await t.mutation(
      internal.catalog.backfill.backfillPuzzleAggregateIds,
      {},
    );
    expect(second.patched).toBe(0);
  });
});
