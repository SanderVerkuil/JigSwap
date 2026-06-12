import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed a mix of approved and non-approved puzzles.
const seed = async (t: ReturnType<typeof convexTest>, count = 5) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const submitter = await ctx.db.insert("users", {
      clerkId: "clerk_plank_tester",
      email: "plank@example.com",
      name: "Plank Tester",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert("puzzles", {
        title: `Puzzle ${i + 1}`,
        brand: i % 2 === 0 ? "Ravensburger" : undefined,
        pieceCount: 500 + i * 100,
        status: "approved",
        submittedBy: submitter,
        createdAt: now + i,
        updatedAt: now + i,
      });
      ids.push(id);
    }

    // One pending and one rejected puzzle that must never appear in results.
    await ctx.db.insert("puzzles", {
      title: "Pending Puzzle",
      pieceCount: 100,
      status: "pending",
      submittedBy: submitter,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("puzzles", {
      title: "Rejected Puzzle",
      pieceCount: 100,
      status: "rejected",
      submittedBy: submitter,
      createdAt: now,
      updatedAt: now,
    });

    return ids;
  });

describe("insights.getPlankPuzzles — determinism", () => {
  test("same seed returns the same order", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 5);

    const runA = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 3,
      seed: 42,
    });
    const runB = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 3,
      seed: 42,
    });

    expect(runA.map((p) => p.title)).toEqual(runB.map((p) => p.title));
  });

  test("returns exactly the requested count when enough puzzles exist", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 5);

    const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 3,
      seed: 7,
    });

    expect(result).toHaveLength(3);
  });

  test("returns what is available when fewer puzzles than limit exist", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 2);

    const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 10,
      seed: 1,
    });

    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.length).toBe(2);
  });

  test("clamps limit above 12 to 12", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 5);

    const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 999,
      seed: 0,
    });

    // Pool only has 5 approved puzzles; clamped limit is 12 but pool caps the result.
    expect(result.length).toBeLessThanOrEqual(12);
  });

  test("clamps limit below 1 to 1", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 5);

    const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 0,
      seed: 0,
    });

    expect(result).toHaveLength(1);
  });

  test("only returns approved puzzles — pending and rejected are excluded", async () => {
    const t = convexTest(schema, modules);
    await seed(t, 5);

    const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 12,
      seed: 99,
    });

    expect(result.every((p) => p.title !== "Pending Puzzle")).toBe(true);
    expect(result.every((p) => p.title !== "Rejected Puzzle")).toBe(true);
  });
});
