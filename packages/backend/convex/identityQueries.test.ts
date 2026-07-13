import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice Anderson",
      username: "alice",
      // searchableName backs the by_searchable_name people-search index and is
      // maintained on every user write (see convex/users.ts toSearchableName).
      searchableName: "alice anderson alice",
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
      searchableName: "bob brown",
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

const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

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
    const byClerk = await asAlice(t).query(
      api.identity.getUserByClerkId.getUserByClerkId,
      { clerkId: "clerk_alice" },
    );
    expect(byClerk?._id).toBe(alice);
    const byId = await asAlice(t).query(api.identity.getUserById.getUserById, {
      userId: alice,
    });
    // MemberView is PII-free: no email/clerkId leak to other members.
    expect(byId?.name).toBe("Alice Anderson");
    expect(byId && "email" in byId).toBe(false);
    expect(byId && "clerkId" in byId).toBe(false);
  });

  test("return null for an unknown clerk id", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await asAlice(t).query(api.identity.getUserByClerkId.getUserByClerkId, {
        clerkId: "nope",
      }),
    ).toBeNull();
  });
});

describe("identity.getUserStats", () => {
  test("rolls owned copies, completed exchanges and received reviews", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const stats = await asAlice(t).query(
      api.identity.getUserStats.getUserStats,
      { userId: alice },
    );
    expect(stats).not.toBeNull();
    expect(stats?.puzzlesOwned).toBe(1);
    expect(stats?.puzzlesAvailable).toBe(1); // legacy quirk: mirrors puzzlesOwned
    expect(stats?.tradesCompleted).toBe(1);
    expect(stats?.averageRating).toBe(4);
    expect(stats?.totalReviews).toBe(1);
  });

  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      t.query(api.identity.getUserStats.getUserStats, { userId: alice }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

// The profile-visibility chokepoint (social/privacy.ts) must also gate the identity reads, so a
// private member's identity and stats can't be enumerated id-by-id by any authenticated member.
// Mirrors the listFollowers/listFollowees visibility tests in socialMutations.test.ts.
describe("identity.getUserById / getUserStats profile-visibility gating", () => {
  test("a private, non-mutual member's identity and stats are hidden (null)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    // Alice follows Bob (one-directional only), then Bob goes private.
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asBob(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    // Alice is not a mutual follower of Bob -> both reads are hidden.
    expect(
      await asAlice(t).query(api.identity.getUserById.getUserById, {
        userId: bob,
      }),
    ).toBeNull();
    expect(
      await asAlice(t).query(api.identity.getUserStats.getUserStats, {
        userId: bob,
      }),
    ).toBeNull();
  });

  test("the owner always sees their own private identity and stats", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    await asBob(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    const self = await asBob(t).query(api.identity.getUserById.getUserById, {
      userId: bob,
    });
    expect(self?.name).toBe("Bob Brown");
    const selfStats = await asBob(t).query(
      api.identity.getUserStats.getUserStats,
      { userId: bob },
    );
    expect(selfStats).not.toBeNull();
  });

  test("a mutual follower sees a private member's identity and stats", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    // Mutual follow, then Bob goes private.
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });
    await asBob(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    const view = await asAlice(t).query(api.identity.getUserById.getUserById, {
      userId: bob,
    });
    expect(view?.name).toBe("Bob Brown");
    const stats = await asAlice(t).query(
      api.identity.getUserStats.getUserStats,
      { userId: bob },
    );
    expect(stats).not.toBeNull();
  });

  test("a public member (default/unset visibility) is unaffected", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    // Bob has no profile row -> profileVisibilityOf defaults to public; Alice (a
    // non-follower) still reads Alice... use Bob viewing Alice, who is public.
    const view = await asBob(t).query(api.identity.getUserById.getUserById, {
      userId: alice,
    });
    expect(view?.name).toBe("Alice Anderson");
    const stats = await asBob(t).query(api.identity.getUserStats.getUserStats, {
      userId: alice,
    });
    expect(stats?.puzzlesOwned).toBe(1);
  });
});

describe("identity.searchUsers", () => {
  test("matches on name/username via the search index, case-insensitively", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Matches on name token.
    const byName = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      {
        searchTerm: "anderson",
      },
    );
    expect(byName.map((u) => u.name)).toContain("Alice Anderson");
    // Matches on username token, case-insensitively.
    const byUsername = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      {
        searchTerm: "ALICE",
      },
    );
    expect(byUsername.map((u) => u.name)).toContain("Alice Anderson");
    // People search is now backed by a single name/username search index, so
    // location is intentionally no longer a search field (deliberate behavior
    // change from the old full-table scan that also matched location).
    const byLocation = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      {
        searchTerm: "amsterdam",
      },
    );
    expect(byLocation).toHaveLength(0);
    // An empty/whitespace term short-circuits to no results.
    const empty = await asAlice(t).query(api.identity.searchUsers.searchUsers, {
      searchTerm: "   ",
    });
    expect(empty).toHaveLength(0);
    const none = await asAlice(t).query(api.identity.searchUsers.searchUsers, {
      searchTerm: "zzz",
    });
    expect(none).toHaveLength(0);
  });

  test("respects the limit", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Two members sharing a search token ("collector") so the term matches both;
    // limit:1 must return only one.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "Carol Collector",
        username: "carol",
        searchableName: "carol collector carol",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("users", {
        clerkId: "clerk_dave",
        email: "dave@example.com",
        name: "Dave Collector",
        username: "dave",
        searchableName: "dave collector dave",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const all = await asAlice(t).query(api.identity.searchUsers.searchUsers, {
      searchTerm: "collector",
    });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const limited = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      {
        searchTerm: "collector",
        limit: 1,
      },
    );
    expect(limited).toHaveLength(1);
  });
});

describe("identity.searchUsers profile-visibility gating", () => {
  // Mirrors search.global people gating: a private member is never surfaced by
  // name/username/avatar to a searcher who is neither them nor a mutual follower.
  const insertUser = (
    t: ReturnType<typeof convexTest>,
    clerkId: string,
    name: string,
    username: string,
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        username,
        searchableName: `${name} ${username}`.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

  const setVisibility = (
    t: ReturnType<typeof convexTest>,
    memberId: Id<"users">,
    visibility: "public" | "private",
  ) =>
    t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        memberId,
        displayName: "x",
        visibility,
        updatedAt: Date.now(),
      });
    });

  const follow = (
    t: ReturnType<typeof convexTest>,
    followerId: Id<"users">,
    followeeId: Id<"users">,
  ) =>
    t.run(async (ctx) => {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    });

  const asSearcher = (t: ReturnType<typeof convexTest>) =>
    t.withIdentity({ subject: "clerk_searcher" });

  test("surfaces a public-profile member to any searcher", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    await insertUser(t, "clerk_target", "Patricia Public", "patricia");

    const res = await asSearcher(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "patricia" },
    );
    expect(res.map((u) => u.name)).toContain("Patricia Public");
  });

  test("hides a private-profile member from a non-connected searcher", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");

    const res = await asSearcher(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "priv" },
    );
    expect(res).toHaveLength(0);
  });

  test("reveals a private member to a mutual follower", async () => {
    const t = convexTest(schema, modules);
    const searcher = await insertUser(
      t,
      "clerk_searcher",
      "Sam Searcher",
      "sam",
    );
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");
    await follow(t, searcher, target);
    await follow(t, target, searcher);

    const res = await asSearcher(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "priv" },
    );
    expect(res.map((u) => u.name)).toContain("Priv Person");
  });

  test("a searcher with a private profile still finds themself", async () => {
    const t = convexTest(schema, modules);
    const searcher = await insertUser(
      t,
      "clerk_searcher",
      "Sam Searcher",
      "sam",
    );
    await setVisibility(t, searcher, "private");

    const res = await asSearcher(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "sam" },
    );
    expect(res.map((u) => u.name)).toContain("Sam Searcher");
  });
});

// Ranking (UX research): match-quality bucket (exact > prefix > fuzzy) is PRIMARY;
// known-follower count only breaks ties WITHIN a bucket. See identity/searchUsers.ts.
describe("identity.searchUsers ranking", () => {
  const insertUser = (
    t: ReturnType<typeof convexTest>,
    clerkId: string,
    name: string,
    username: string,
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        username,
        searchableName: `${name} ${username}`.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

  const follow = (
    t: ReturnType<typeof convexTest>,
    followerId: Id<"users">,
    followeeId: Id<"users">,
  ) =>
    t.run(async (ctx) => {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    });

  const asClerk = (t: ReturnType<typeof convexTest>, clerkId: string) =>
    t.withIdentity({ subject: clerkId });

  test("within the same match bucket, more known-followers ranks first", async () => {
    const t = convexTest(schema, modules);
    const viewer = await insertUser(t, "clerk_viewer", "Vera Viewer", "vera");
    const connectorA = await insertUser(t, "clerk_ca", "Connector A", "conna");
    const connectorB = await insertUser(t, "clerk_cb", "Connector B", "connb");
    // Both are exact matches for "henk" (same bucket) - henkA has 2 known-followers
    // (two accounts the viewer follows also follow henkA), henkB has none.
    const henkA = await insertUser(t, "clerk_henka", "Henk", "henka");
    const henkB = await insertUser(t, "clerk_henkb", "Henk", "henkb");

    await follow(t, viewer, connectorA);
    await follow(t, viewer, connectorB);
    await follow(t, connectorA, henkA);
    await follow(t, connectorB, henkA);

    const res = await asClerk(t, "clerk_viewer").query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "henk" },
    );
    const ids = res.map((u) => u._id);
    expect(ids.indexOf(henkA)).toBeLessThan(ids.indexOf(henkB));
  });

  test("bucket dominates: an exact match with zero known-followers outranks a fuzzy match with many", async () => {
    const t = convexTest(schema, modules);
    const viewer = await insertUser(t, "clerk_viewer2", "Vera Viewer", "vera2");
    const connectors = [
      await insertUser(t, "clerk_c1", "Connector One", "conn1"),
      await insertUser(t, "clerk_c2", "Connector Two", "conn2"),
      await insertUser(t, "clerk_c3", "Connector Three", "conn3"),
    ];
    // Exact match on "henk", zero known-followers.
    const exactHenk = await insertUser(t, "clerk_exact", "Henk", "henkexact");
    // Fuzzy match only (neither name nor username equals/starts-with "henk" - "henk" is a
    // middle search-index token of "Van Henk"/"vanhenk92"), but has 3 known-followers.
    const fuzzyVanHenk = await insertUser(
      t,
      "clerk_fuzzy",
      "Van Henk",
      "vanhenk92",
    );

    for (const connector of connectors) {
      await follow(t, viewer, connector);
      await follow(t, connector, fuzzyVanHenk);
    }

    const res = await asClerk(t, "clerk_viewer2").query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "henk" },
    );
    const ids = res.map((u) => u._id);
    expect(ids).toContain(exactHenk);
    expect(ids).toContain(fuzzyVanHenk);
    expect(ids.indexOf(exactHenk)).toBeLessThan(ids.indexOf(fuzzyVanHenk));
  });

  test("a zero-connection new member is still returned for an exact-name search", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_viewer3", "Vera Viewer", "vera3");
    const newMember = await insertUser(t, "clerk_new", "Zoltan", "zoltan");

    const res = await asClerk(t, "clerk_viewer3").query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "zoltan" },
    );
    expect(res.map((u) => u._id)).toContain(newMember);
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
