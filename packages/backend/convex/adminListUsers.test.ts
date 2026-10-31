import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Three members (Alice is the mirrored admin), one approved definition, two copies owned by Bob.
const seed = async (t: TestConvex<typeof schema>) =>
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

    const alice = await mkUser("clerk_alice", "Alice", {
      role: "admin",
      username: "alice",
    });
    const bob = await mkUser("clerk_bob", "Bob");
    await mkUser("clerk_cleo", "Cleo");

    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    for (const aggregateId of ["copy-1", "copy-2"]) {
      await ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId: puzzle,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    }
  });

const asMember = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const firstPage = { paginationOpts: { numItems: 10, cursor: null } };

describe("admin/listUsers", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.admin.listUsers.listUsers, firstPage),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member (fails closed — the JWT gates, never users.role)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Alice's ROW carries role "admin" (the display mirror), but her identity has no
    // metadata.role claim — the gate must still refuse her.
    await expect(
      asMember(t).query(api.admin.listUsers.listUsers, firstPage),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns every member, newest first, with role and owned-copy count", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAdmin(t).query(
      api.admin.listUsers.listUsers,
      firstPage,
    );
    expect(result.isDone).toBe(true);
    expect(result.page.map((u) => u.name)).toEqual(["Cleo", "Bob", "Alice"]);
    const alice = result.page.find((u) => u.name === "Alice");
    expect(alice).toMatchObject({
      username: "alice",
      email: "clerk_alice@example.com",
      isActive: true,
      role: "admin",
      ownedCopyCount: 0,
    });
    const bob = result.page.find((u) => u.name === "Bob");
    expect(bob?.role).toBeUndefined();
    expect(bob?.ownedCopyCount).toBe(2);
  });

  test("paginates with a continue cursor", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const page1 = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(page1.page).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    const page2 = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 2, cursor: page1.continueCursor },
    });
    expect(page2.page.map((u) => u.name)).toEqual(["Alice"]);
    expect(page2.isDone).toBe(true);
  });

  test("search narrows via the by_searchable_name index", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      ...firstPage,
      search: "cleo",
    });
    expect(result.page.map((u) => u.name)).toEqual(["Cleo"]);
  });

  test("an email address finds exactly that member (e.g. from a contact message)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      ...firstPage,
      search: "  clerk_bob@example.com ",
    });
    expect(result.page.map((u) => u.name)).toEqual(["Bob"]);
    expect(result.page[0].ownedCopyCount).toBe(2);
    expect(result.isDone).toBe(true);

    // A visitor may type their address in other case than the member's verified one.
    const shouted = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      ...firstPage,
      search: "Clerk_Bob@Example.com",
    });
    expect(shouted.page.map((u) => u.name)).toEqual(["Bob"]);
  });

  test("an address stored in mixed case is found as typed", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_dana",
        email: "Dana.Jansen@Example.nl",
        name: "Dana",
        searchableName: "dana",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const result = await asAdmin(t).query(api.admin.listUsers.listUsers, {
      ...firstPage,
      search: "Dana.Jansen@Example.nl",
    });
    expect(result.page.map((u) => u.name)).toEqual(["Dana"]);
  });

  test("a partial or unknown address matches no one", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    for (const search of [
      "clerk_bob@example",
      "clerk_bob@exam",
      "bob@example.com",
      "nobody@example.com",
    ]) {
      const result = await asAdmin(t).query(api.admin.listUsers.listUsers, {
        ...firstPage,
        search,
      });
      expect(result.page).toEqual([]);
      expect(result.isDone).toBe(true);
    }
  });

  test("search is also admin-gated", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(api.admin.listUsers.listUsers, {
        ...firstPage,
        search: "cleo",
      }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asMember(t).query(api.admin.listUsers.listUsers, {
        ...firstPage,
        search: "clerk_bob@example.com",
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});
