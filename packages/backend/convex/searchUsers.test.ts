import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: TestConvex<typeof schema>) =>
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

const asAlice = (t: TestConvex<typeof schema>) =>
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

// SEC-49: the result size is clamped server-side, whatever `limit` the client sends.
describe("searchUsers limit", () => {
  const seedMany = (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("users", {
          clerkId: `clerk_bo_${i}`,
          email: `bo${i}@example.com`,
          name: `Bo ${i}`,
          searchableName: `bo ${i}`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

  test("a non-finite limit returns the default 20; a negative one a single match", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedMany(t);
    const nan = await asAlice(t).query(api.identity.searchUsers.searchUsers, {
      searchTerm: "bo",
      limit: Number.NaN,
    });
    expect(nan).toHaveLength(20);
    const negative = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "bo", limit: -3 },
    );
    expect(negative).toHaveLength(1);
  });
});
