import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory test runtime, excluding test files.
export const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

describe("convex-test harness", () => {
  test("runs an existing query against an in-memory deployment", async () => {
    const t = convexTest(schema, modules);
    const stats = await t.query(api.insights.getGlobalStats.getGlobalStats, {});
    expect(stats).toEqual({
      totalUsers: 0,
      totalPuzzles: 0,
      totalOwnedPuzzles: 0,
    });
  });
});
