import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const active = await ctx.db.insert("adminCategories", {
      name: { en: "Active Cat", nl: "Actief" },
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    const inactive = await ctx.db.insert("adminCategories", {
      name: { en: "Hidden Cat", nl: "Verborgen" },
      isActive: false,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { active, inactive };
  });

const asMember = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

describe("adminCategories admin-only reads", () => {
  test("getAllAdminCategories rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.adminCategories.getAllAdminCategories, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("getAllAdminCategories rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(api.adminCategories.getAllAdminCategories, {}),
    ).rejects.toThrow(/Forbidden/);
  });

  test("getAllAdminCategories returns all (incl. inactive) for an admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const all = await asAdmin(t).query(
      api.adminCategories.getAllAdminCategories,
      {},
    );
    expect(all.map((c) => c.name.en).sort()).toEqual([
      "Active Cat",
      "Hidden Cat",
    ]);
  });

  test("the public taxonomy (getPuzzleCategories) lists active rows only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const active = await t.query(
      api.catalog.getPuzzleCategories.getPuzzleCategories,
      {},
    );
    expect(active.map((c) => c.name.en)).toEqual(["Active Cat"]);
  });
});
