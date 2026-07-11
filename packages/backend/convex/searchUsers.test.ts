import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    for (const [clerkId, name] of [
      ["clerk_alice", "Alice"],
      ["clerk_bo", "Bo"],
    ] as const) {
      await ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("searchUsers minimum query length", () => {
  test("returns [] for empty and 1-character terms without hitting the index", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    for (const searchTerm of ["", " ", "b", " b "]) {
      const result = await asAlice(t).query(
        api.identity.searchUsers.searchUsers,
        { searchTerm },
      );
      expect(result).toEqual([]);
    }
  });

  test("still searches from 2 characters", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "bo" },
    );
    expect(result.map((m) => m.name)).toContain("Bo");
  });
});
