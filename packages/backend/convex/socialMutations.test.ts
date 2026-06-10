import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

const seed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com");
    const bob = await mkUser("clerk_bob", "bob@example.com");
    const carol = await mkUser("clerk_carol", "carol@example.com");
    return { alice, bob, carol };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("follow / unfollow", () => {
  test("a member can follow another and the edge is queryable both ways", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    const followId = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(typeof followId).toBe("string");

    expect(
      await asAlice(t).query(api.social.isFollowing.isFollowing, {
        followeeId: bob,
      }),
    ).toBe(true);

    const aliceFollowees = await asAlice(t).query(
      api.social.listFollowees.listFollowees,
      {},
    );
    expect(aliceFollowees.map((f) => f.memberId)).toContain(bob as string);

    const bobFollowers = await asBob(t).query(
      api.social.listFollowers.listFollowers,
      {},
    );
    expect(bobFollowers.map((f) => f.memberId)).toContain(alice as string);
  });

  test("following twice is rejected (pair-uniqueness)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await expect(
      asAlice(t).mutation(api.social.followMember.followMember, {
        followeeId: bob,
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("a member cannot follow themselves", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      asAlice(t).mutation(api.social.followMember.followMember, {
        followeeId: alice,
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("unfollow removes the edge; unfollowing a non-followee is rejected", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asAlice(t).mutation(api.social.unfollowMember.unfollowMember, {
      followeeId: bob,
    });
    expect(
      await asAlice(t).query(api.social.isFollowing.isFollowing, {
        followeeId: bob,
      }),
    ).toBe(false);

    await expect(
      asAlice(t).mutation(api.social.unfollowMember.unfollowMember, {
        followeeId: bob,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("editProfile", () => {
  test("first edit creates the profile; a later edit updates it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
      bio: "I love jigsaws",
    });
    let profile = await asAlice(t).query(api.social.getProfile.getProfile, {});
    expect(profile?.displayName).toBe("Alice A.");
    expect(profile?.bio).toBe("I love jigsaws");
    expect(profile?.aggregateId).toBeDefined();
    const firstAggregateId = profile?.aggregateId;

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice Updated",
    });
    profile = await asAlice(t).query(api.social.getProfile.getProfile, {});
    expect(profile?.displayName).toBe("Alice Updated");
    expect(profile?.bio).toBeUndefined();
    // Editing keeps the same aggregate (no new profile minted).
    expect(profile?.aggregateId).toBe(firstAggregateId);
  });

  test("an empty display name is rejected (InvalidDisplayName)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asAlice(t).mutation(api.social.editProfile.editProfile, {
        displayName: "   ",
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("editProfile records a ProfileUpdated domain event", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });
    const events = await t.run((ctx) =>
      ctx.db.query("domainEvents").collect(),
    );
    expect(events.map((e) => e.name)).toContain("ProfileUpdated");
  });
});

describe("activity feed projection", () => {
  // Seed activity events directly into the durable log (mirrors what other contexts emit), then
  // assert the feed maps + scopes them through buildActivityFeed.
  const insertEvent = (
    t: ReturnType<typeof convexTest>,
    name: string,
    payload: Record<string, unknown>,
    occurredAt: number,
    context: string,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("domainEvents", { name, payload, occurredAt, context }),
    );

  test("feed includes own + followed members' activity, newest-first", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);

    // Alice follows Bob (but not Carol).
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });

    const base = Date.now();
    // Alice's own completion (oldest).
    await insertEvent(
      t,
      "CompletionRecorded",
      { userId: alice as string, completionId: "compl-alice" },
      base,
      "solving",
    );
    // Bob's acquisition (followed).
    await insertEvent(
      t,
      "CopyAcquired",
      { ownerId: bob as string, copyId: "copy-bob" },
      base + 1000,
      "library",
    );
    // Carol's completion (NOT followed) — must be excluded.
    await insertEvent(
      t,
      "CompletionRecorded",
      { userId: carol as string, completionId: "compl-carol" },
      base + 2000,
      "solving",
    );

    const feed = await asAlice(t).query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );

    // Carol excluded; Alice + Bob present.
    expect(feed.map((e) => e.ref)).toEqual(["copy-bob", "compl-alice"]);
    expect(feed[0].kind).toBe("acquisition");
    expect(feed[0].memberId).toBe(bob as string);
    expect(feed[1].kind).toBe("completion");
  });

  test("ExchangeCompleted is attributed to both parties via the exchange row", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    // Persist an exchange row keyed by aggregateId so the seam can resolve its parties.
    const exchangeAggregateId = "exch-1";
    await t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "P",
        pieceCount: 100,
        status: "approved",
        submittedBy: bob,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("exchanges", {
        aggregateId: exchangeAggregateId,
        initiatorId: alice,
        recipientId: bob,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await insertEvent(
      t,
      "ExchangeCompleted",
      { exchangeId: exchangeAggregateId },
      Date.now(),
      "exchange",
    );

    // Alice (a party) sees the settlement attributed to herself.
    const feed = await asAlice(t).query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("exchange");
    expect(feed[0].ref).toBe(exchangeAggregateId);
    expect(feed[0].memberId).toBe(alice as string);
  });
});
