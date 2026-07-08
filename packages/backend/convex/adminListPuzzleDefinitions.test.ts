import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Admin read model over ALL definitions regardless of status (the public lists filter to
// approved), newest first, paginated, with submitter name and distinct-owner count joined in.

const seedMember = async (t: ReturnType<typeof convexTest>) =>
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

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// One puzzle per status, inserted oldest→newest so order("desc") returns the reverse.
const seedPuzzles = (t: ReturnType<typeof convexTest>, alice: Id<"users">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const statuses = ["approved", "pending", "rejected", "disabled"] as const;
    const ids: Id<"puzzles">[] = [];
    for (const [i, status] of statuses.entries()) {
      ids.push(
        await ctx.db.insert("puzzles", {
          aggregateId: `agg-${status}`,
          title: `Puzzle ${status}`,
          pieceCount: 500 + i,
          status,
          submittedBy: alice,
          createdAt: now + i,
          updatedAt: now + i,
        }),
      );
    }
    return ids;
  });

const listPage = (
  t: ReturnType<typeof convexTest>,
  paginationOpts: { numItems: number; cursor: string | null },
) =>
  asAdmin(t).query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
    paginationOpts,
  });

describe("admin.listPuzzleDefinitions", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expect(
      t.query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns EVERY status newest-first with submitter name joined in", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzles(t, alice);

    const result = await listPage(t, { numItems: 10, cursor: null });
    expect(result.isDone).toBe(true);
    expect(result.page.map((row) => row.status)).toEqual([
      "disabled",
      "rejected",
      "pending",
      "approved",
    ]);
    expect(result.page[0]).toMatchObject({
      aggregateId: "agg-disabled",
      title: "Puzzle disabled",
      pieceCount: 503,
      submitterName: "Alice",
      ownerCount: 0,
      image: null,
    });
    expect(typeof result.page[0].createdAt).toBe("number");
  });

  test("counts DISTINCT owners per definition", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const [approvedId] = await seedPuzzles(t, alice);

    await t.run(async (ctx) => {
      const now = Date.now();
      const bob = await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const copy = (ownerId: Id<"users">) =>
        ctx.db.insert("ownedPuzzles", {
          puzzleId: approvedId,
          ownerId,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          snapshot: { title: "Puzzle approved", pieceCount: 500 },
          createdAt: now,
          updatedAt: now,
        });
      // Alice owns TWO copies, Bob one: distinct owners = 2.
      await copy(alice);
      await copy(alice);
      await copy(bob);
    });

    const result = await listPage(t, { numItems: 10, cursor: null });
    const approved = result.page.find((row) => row.status === "approved");
    expect(approved?.ownerCount).toBe(2);
  });

  test("paginates with a continue cursor", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzles(t, alice);

    const first = await listPage(t, { numItems: 3, cursor: null });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);

    const second = await listPage(t, {
      numItems: 3,
      cursor: first.continueCursor,
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(second.page[0].status).toBe("approved");
  });
});
