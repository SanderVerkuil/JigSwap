import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Nine members inserted oldest-first (insert order fixes _creationTime order).
// alice = the viewer; carol is private; dave is inactive; everyone else public.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    await mkUser("clerk_alice", "Alice");
    await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    await ctx.db.insert("profiles", {
      memberId: carol,
      displayName: "Carol",
      visibility: "private",
      updatedAt: now,
    });
    await mkUser("clerk_dave", "Dave", { isActive: false });
    const eve = await mkUser("clerk_eve", "Eve");
    // An explicit PUBLIC profile row must also pass the gate (not only "no row").
    await ctx.db.insert("profiles", {
      memberId: eve,
      displayName: "Eve",
      visibility: "public",
      updatedAt: now,
    });
    await mkUser("clerk_frank", "Frank");
    await mkUser("clerk_grace", "Grace");
    await mkUser("clerk_henry", "Henry");
    await mkUser("clerk_ivy", "Ivy");
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("listRecentPublicMembers", () => {
  test("returns newest public members first, capped at 5", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    // Newest-first: ivy, henry, grace, frank, [dave skipped: inactive],
    // [carol skipped: private], eve fills the 5th slot; bob dropped by the cap.
    expect(result.map((m) => m.name)).toEqual([
      "Ivy",
      "Henry",
      "Grace",
      "Frank",
      "Eve",
    ]);
  });

  test("never surfaces private, inactive, or the viewer themself", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    const names = result.map((m) => m.name);
    expect(names).not.toContain("Carol"); // private profile
    expect(names).not.toContain("Dave"); // inactive
    expect(names).not.toContain("Alice"); // the viewer
  });

  test("emits PII-free MemberView (no email, no clerkId)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m).not.toHaveProperty("email");
      expect(m).not.toHaveProperty("clerkId");
    }
  });

  test("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.identity.listRecentPublicMembers.listRecentPublicMembers, {}),
    ).rejects.toThrow();
  });
});
