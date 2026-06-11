import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice Anderson",
      username: "alice",
      location: "Amsterdam",
      bio: "Loves 1000-piece puzzles",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob Brown",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzle,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    // One completed exchange (alice initiator) + one received 4-star review -> stats.
    const exchange = await ctx.db.insert("exchanges", {
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: copy,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("reviews", {
      exchangeId: exchange,
      reviewerId: bob,
      revieweeId: alice,
      rating: 4,
      categories: {
        communication: 4,
        packaging: 4,
        condition: 4,
        timeliness: 4,
      },
      createdAt: now,
    });

    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("identity.getCurrentUser", () => {
  test("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.identity.getCurrentUser.getCurrentUser, {}),
    ).toBeNull();
  });

  test("returns the signed-in member as a MemberView", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const me = await asAlice(t).query(
      api.identity.getCurrentUser.getCurrentUser,
      {},
    );
    expect(me?.name).toBe("Alice Anderson");
    expect(me?.bio).toBe("Loves 1000-piece puzzles");
    expect(me?.clerkId).toBe("clerk_alice");
  });
});

describe("identity.getUserByClerkId / getUserById", () => {
  test("resolve the same member by clerk id and _id", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const byClerk = await t.query(
      api.identity.getUserByClerkId.getUserByClerkId,
      { clerkId: "clerk_alice" },
    );
    expect(byClerk?._id).toBe(alice);
    const byId = await t.query(api.identity.getUserById.getUserById, {
      userId: alice,
    });
    expect(byId?.email).toBe("alice@example.com");
  });

  test("return null for an unknown clerk id", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.identity.getUserByClerkId.getUserByClerkId, {
        clerkId: "nope",
      }),
    ).toBeNull();
  });
});

describe("identity.getUserStats", () => {
  test("rolls owned copies, completed exchanges and received reviews", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const stats = await t.query(api.identity.getUserStats.getUserStats, {
      userId: alice,
    });
    expect(stats.puzzlesOwned).toBe(1);
    expect(stats.puzzlesAvailable).toBe(1); // legacy quirk: mirrors puzzlesOwned
    expect(stats.tradesCompleted).toBe(1);
    expect(stats.averageRating).toBe(4);
    expect(stats.totalReviews).toBe(1);
  });
});

describe("identity.searchUsers", () => {
  test("matches on name/username/location, case-insensitively", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const byName = await t.query(api.identity.searchUsers.searchUsers, {
      searchTerm: "alice",
    });
    expect(byName.map((u) => u.name)).toContain("Alice Anderson");
    const byLocation = await t.query(api.identity.searchUsers.searchUsers, {
      searchTerm: "amsterdam",
    });
    expect(byLocation).toHaveLength(1);
    const none = await t.query(api.identity.searchUsers.searchUsers, {
      searchTerm: "zzz",
    });
    expect(none).toHaveLength(0);
  });

  test("respects the limit", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Both Alice and Bob contain no shared token except an empty term, which matches all.
    const limited = await t.query(api.identity.searchUsers.searchUsers, {
      searchTerm: "",
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });
});

describe("insights.getGlobalStats", () => {
  test("counts members, catalog definitions and owned copies", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const stats = await t.query(api.insights.getGlobalStats.getGlobalStats, {});
    expect(stats).toEqual({
      totalUsers: 2,
      totalPuzzles: 1,
      totalOwnedPuzzles: 1,
    });
  });
});
