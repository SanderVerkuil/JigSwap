import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NO_AVAILABILITY = { forTrade: false, forSale: false, forLend: false };

// alice: public member with a profile (bio "I love gradients"), consented avatar, one owned
// puzzle, one completed exchange with bob (a 4-star review), a mutual follow with bob, and three
// completed puzzles (one a legacy row with no copySnapshot, exercising the puzzles-join fallback)
// plus one IN-PROGRESS completion that must never count.
// carol: private member (no avatar consent) with a distinctive completion (pieceCount 31415,
// title "Should Not Leak") used to prove nothing besides `hero` crosses the wire when locked.
// dave: mutual follower of carol. eve: signed-in but unrelated to carol (non-mutual).
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      username: "alice",
      avatar: "https://img.example/alice.png",
      location: "Utrecht",
      shareAvatarPublicly: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: alice,
      displayName: "Alice",
      bio: "I love gradients",
      visibility: "public",
      updatedAt: now,
    });

    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const frank = await ctx.db.insert("users", {
      clerkId: "clerk_frank",
      email: "frank@example.com",
      name: "Frank",
      username: "frank",
      avatar: "https://img.example/frank.png",
      // No shareAvatarPublicly: avatar must not reach anonymous callers.
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const carol = await ctx.db.insert("users", {
      clerkId: "clerk_carol",
      email: "carol@example.com",
      name: "Carol",
      username: "carol",
      avatar: "https://img.example/carol.png",
      location: "Amsterdam",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: carol,
      displayName: "Carol de Puzzelaar",
      bio: "TopSecretBio",
      visibility: "private",
      updatedAt: now,
    });

    const dave = await ctx.db.insert("users", {
      clerkId: "clerk_dave",
      email: "dave@example.com",
      name: "Dave",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const eve = await ctx.db.insert("users", {
      clerkId: "clerk_eve",
      email: "eve@example.com",
      name: "Eve",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // alice <-> bob mutual follow.
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: now,
    });
    // carol <-> dave mutual follow. eve has no relation to carol (non-mutual).
    await ctx.db.insert("follows", {
      followerId: dave,
      followeeId: carol,
      createdAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: carol,
      followeeId: dave,
      createdAt: now,
    });

    // alice: one owned puzzle.
    const alicePuzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const aliceCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: alicePuzzle,
      ownerId: alice,
      condition: "good",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });

    // One completed trade (alice initiator) + a 4-star review from bob -> stats.swaps/rating.
    const exchange = await ctx.db.insert("exchanges", {
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: aliceCopy,
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

    // A legacy puzzle definition alice completed WITHOUT a copySnapshot, exercising the
    // puzzles-join fallback for both pieceCount and title.
    const legacyPuzzle = await ctx.db.insert("puzzles", {
      title: "Legacy Puzzle",
      pieceCount: 800,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    // Fastest (60 min, 500 pieces).
    await ctx.db.insert("completions", {
      userId: alice,
      startDate: now,
      endDate: now,
      completionTimeMinutes: 60,
      photos: [],
      isCompleted: true,
      copySnapshot: {
        copyId: "copy-a",
        ownerId: alice,
        wasBorrowed: false,
        condition: "good",
        title: "Small Scene",
        pieceCount: 500,
      },
      createdAt: now,
      updatedAt: now,
    });
    // Hardest (1200 pieces, 200 min).
    await ctx.db.insert("completions", {
      userId: alice,
      startDate: now,
      endDate: now,
      completionTimeMinutes: 200,
      photos: [],
      isCompleted: true,
      copySnapshot: {
        copyId: "copy-b",
        ownerId: alice,
        wasBorrowed: false,
        condition: "good",
        title: "Mega Vista",
        pieceCount: 1200,
      },
      createdAt: now,
      updatedAt: now,
    });
    // Legacy row: no copySnapshot at all, no completionTimeMinutes -> joins to legacyPuzzle for
    // pieceCount/title, never becomes `fastest` (no time), never becomes `hardest` (800 < 1200).
    await ctx.db.insert("completions", {
      userId: alice,
      puzzleId: legacyPuzzle,
      startDate: now,
      endDate: now,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    // In-progress: must never count toward completions/piecesPlaced/records.
    await ctx.db.insert("completions", {
      userId: alice,
      startDate: now,
      photos: [],
      isCompleted: false,
      copySnapshot: {
        copyId: "copy-d",
        ownerId: alice,
        wasBorrowed: false,
        condition: "good",
        title: "Unfinished",
        pieceCount: 999,
      },
      createdAt: now,
      updatedAt: now,
    });

    // carol: one owned puzzle + one completed, distinctive puzzle -> proves nothing here leaks
    // when the profile is locked.
    const carolPuzzle = await ctx.db.insert("puzzles", {
      title: "Should Not Leak",
      pieceCount: 31415,
      status: "approved",
      submittedBy: carol,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: carolPuzzle,
      ownerId: carol,
      condition: "good",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completions", {
      userId: carol,
      startDate: now,
      endDate: now,
      completionTimeMinutes: 42,
      photos: [],
      isCompleted: true,
      copySnapshot: {
        copyId: "copy-carol",
        ownerId: carol,
        wasBorrowed: false,
        condition: "good",
        title: "Should Not Leak",
        pieceCount: 31415,
      },
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, frank, carol, dave, eve };
  });

describe("getPublicProfile", () => {
  test("public profile, logged-out: unlocked, full hero WITH location, stats, and records", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: "alice",
    });
    expect(view).not.toBeNull();
    if (!view || view.locked) throw new Error("expected unlocked");

    expect(view.hero.displayName).toBe("Alice");
    expect(view.hero.username).toBe("alice");
    expect(view.hero.visibility).toBe("public");
    expect(view.hero.location).toBe("Utrecht");
    expect(view.hero.rating).toBe(4);
    expect(view.hero.reviewCount).toBe(1);
    expect(view.hero.followerCount).toBe(1);
    expect(view.hero.followingCount).toBe(1);
    expect(view.hero.avatar).toBe("https://img.example/alice.png");

    expect(view.story).toBe("I love gradients");

    expect(view.stats.puzzlesOwned).toBe(1);
    expect(view.stats.completions).toBe(3);
    expect(view.stats.piecesPlaced).toBe(2500); // 500 + 1200 + 800 (legacy join)
    expect(view.stats.swaps).toBe(1);

    expect(view.records.fastest).toEqual({ title: "Small Scene", minutes: 60 });
    expect(view.records.hardest).toEqual({
      title: "Mega Vista",
      pieceCount: 1200,
    });
  });

  test("avatar consent: anonymous caller sees the avatar only when shareAvatarPublicly is set", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const aliceView = await t.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "alice" },
    );
    expect(aliceView).not.toBeNull();
    if (!aliceView || aliceView.locked) throw new Error("expected unlocked");
    expect(aliceView.hero.avatar).toBe("https://img.example/alice.png");

    const frankView = await t.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "frank" },
    );
    expect(frankView).not.toBeNull();
    if (!frankView || frankView.locked) throw new Error("expected unlocked");
    expect(frankView.hero.avatar).toBeUndefined();
  });

  test("private profile, logged-out: locked, hero present but location undefined, no story/stats/records", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: "carol",
    });
    expect(view).not.toBeNull();
    expect(view!.locked).toBe(true);
    expect(view!.hero.visibility).toBe("private");
    expect(view!.hero.location).toBeUndefined();
    expect(view).not.toHaveProperty("story");
    expect(view).not.toHaveProperty("stats");
    expect(view).not.toHaveProperty("records");
  });

  test("private profile, logged-in non-mutual viewer: locked, same as logged-out", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asEve = t.withIdentity({ subject: "clerk_eve" });
    const view = await asEve.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "carol" },
    );
    expect(view).not.toBeNull();
    expect(view!.locked).toBe(true);
    expect(view!.hero.location).toBeUndefined();
    expect(view).not.toHaveProperty("story");
    expect(view).not.toHaveProperty("stats");
    expect(view).not.toHaveProperty("records");
  });

  test("private profile, mutual follower: unlocked BUT location still undefined (strict rule)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asDave = t.withIdentity({ subject: "clerk_dave" });
    const view = await asDave.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "carol" },
    );
    expect(view).not.toBeNull();
    if (!view || view.locked) throw new Error("expected unlocked");
    expect(view.hero.location).toBeUndefined();
    expect(view.story).toBe("TopSecretBio");
    expect(view.stats.completions).toBe(1);
    expect(view.stats.piecesPlaced).toBe(31415);
    expect(view.records.fastest).toEqual({
      title: "Should Not Leak",
      minutes: 42,
    });
    expect(view.records.hardest).toEqual({
      title: "Should Not Leak",
      pieceCount: 31415,
    });
  });

  test("self viewing own private profile: unlocked (owner sees own data), location still gated on visibility===public", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asCarol = t.withIdentity({ subject: "clerk_carol" });
    const view = await asCarol.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "carol" },
    );
    expect(view).not.toBeNull();
    if (!view || view.locked) throw new Error("expected unlocked");
    // Documented strict rule: even the owner's own view hides location while private — the edit
    // page (not this read) is where the owner manages their own location.
    expect(view.hero.location).toBeUndefined();
    expect(view.story).toBe("TopSecretBio");
    expect(view.stats.puzzlesOwned).toBe(1);
  });

  test("resolves by slug and by username; id-first precedence intact (shared resolver)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(alice, { slug: "gridmaster" });
    });

    const bySlug = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: "gridmaster",
    });
    expect(bySlug).not.toBeNull();
    if (!bySlug || bySlug.locked) throw new Error("expected unlocked");
    expect(bySlug.hero.memberId).toBe(alice);

    const byUsername = await t.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "alice" },
    );
    expect(byUsername).not.toBeNull();
    if (!byUsername || byUsername.locked) throw new Error("expected unlocked");
    expect(byUsername.hero.memberId).toBe(alice);

    // Id-first precedence: a shadower's username equal to `target`'s id string must never hijack
    // the id URL.
    const { target, shadower } = await t.run(async (ctx) => {
      const now = Date.now();
      const target = await ctx.db.insert("users", {
        clerkId: "clerk_target",
        email: "target@example.com",
        name: "Target",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const shadower = await ctx.db.insert("users", {
        clerkId: "clerk_shadower",
        email: "shadower@example.com",
        name: "Shadower",
        username: target,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return { target, shadower };
    });

    const byId = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: target,
    });
    expect(byId).not.toBeNull();
    if (!byId || byId.locked) throw new Error("expected unlocked");
    expect(byId.hero.memberId).toBe(target);
    expect(byId.hero.memberId).not.toBe(shadower);
  });

  test("leak assertion: a locked payload never contains location, bio, or gated stat numbers", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: "carol",
    });
    expect(view).not.toBeNull();
    expect(view!.locked).toBe(true);

    const json = JSON.stringify(view);
    expect(json).not.toContain("Amsterdam"); // location
    expect(json).not.toContain("TopSecretBio"); // bio / story
    expect(json).not.toContain("31415"); // gated stat/record piece count
    expect(json).not.toContain("Should Not Leak"); // gated record title
  });
});
