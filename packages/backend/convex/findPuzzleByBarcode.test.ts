import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedPuzzle = (extra: Record<string, unknown>) => ({
  title: "Mountain Vista",
  pieceCount: 1000,
  status: "approved" as const,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe("catalog.findPuzzleByBarcode", () => {
  test("returns an approved match by EAN", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c1", email: "a@b.c", name: "A", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ ean: "4005556150007", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      ean: "4005556150007",
    });
    expect(match?.title).toBe("Mountain Vista");
  });

  test("ignores pending matches and returns null", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c2", email: "d@e.f", name: "B", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ ean: "111", status: "pending", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      ean: "111",
    });
    expect(match).toBeNull();
  });

  test("returns an approved match by UPC", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c3", email: "g@h.i", name: "C", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ upc: "036000291452", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      upc: "036000291452",
    });
    expect(match?.title).toBe("Mountain Vista");
  });

  test("ignores rejected matches and returns null", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c4", email: "j@k.l", name: "D", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ ean: "222", status: "rejected", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      ean: "222",
    });
    expect(match).toBeNull();
  });
});
