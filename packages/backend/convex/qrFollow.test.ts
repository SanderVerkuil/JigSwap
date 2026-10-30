import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { establishMutualFollow } from "./social/establishMutualFollow";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
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
    return { alice, bob };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const followEdges = (
  t: TestConvex<typeof schema>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    const ab = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", a).eq("followeeId", b),
      )
      .unique();
    const ba = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", b).eq("followeeId", a),
      )
      .unique();
    return { ab: ab !== null, ba: ba !== null };
  });

// Event dispatch (MemberFollowed -> Notifications subscriber) runs via scheduled functions;
// yield + drain repeatedly so the notification rows land before we assert on them.
const flushScheduled = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsFor = (t: TestConvex<typeof schema>, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

describe("acceptQrFollow", () => {
  test("valid foreign token establishes the mutual follow and bumps the counter", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.followsEstablished).toBe(1);
  });

  test("is idempotent when edges already exist (one direction pre-followed)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob already follows Alice
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    // No duplicate edges
    const bobToAlice = await t.run((ctx) =>
      ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", bob).eq("followeeId", alice),
        )
        .collect(),
    );
    expect(bobToAlice).toHaveLength(1);
  });

  test("own token and invalid/revoked tokens are silently ignored", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Own token
    expect(
      await asAlice(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: false });

    // Revoked token
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: false });

    // Unknown token
    expect(
      await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token: "nope",
      }),
    ).toEqual({ established: false });

    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
  });

  test("a public owner's scan approves a pending request left from when they were private", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob asked to follow Alice while she was private; she has since gone public (no profiles
    // row reads as public). A public owner may be followed at once, so the stale request goes
    // too. A PRIVATE owner's pending request is never approved by a scan: see the SEC-42 block.
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
      token,
    });

    const request = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", bob).eq("targetId", alice),
        )
        .unique(),
    );
    expect(request?.status).toBe("approved");
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });
  });

  test("respects the decline cooldown: a declined-in-cooldown scanner is silently refused", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob asked to follow private Alice, Alice declined — still inside the 7-day cooldown.
    const declinedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      });
    });

    // Bob scans Alice's QR (or a forwarded link) — the anti-pester invariant holds: no path
    // lets a declined requester force a connection during the cooldown.
    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });

    // No counter bump, and the declined row is untouched.
    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.followsEstablished).toBe(0);
    const request = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", bob).eq("targetId", alice),
        )
        .unique(),
    );
    expect(request?.status).toBe("declined");
    expect(request?.respondedAt).toBe(declinedAt);
  });

  test("an EXPIRED decline no longer blocks the scan and the stale row flips to approved", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Alice declined Bob 8 days ago — the 7-day cooldown has expired.
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "declined",
        createdAt: eightDaysAgo,
        respondedAt: eightDaysAgo,
      });
    });

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    const request = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", bob).eq("targetId", alice),
        )
        .unique(),
    );
    expect(request?.status).toBe("approved");
    expect(request?.respondedAt).toBeGreaterThan(eightDaysAgo);
  });

  test("a repeat tap when already mutual reports established:false and does not bump the counter", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // First tap establishes the mutual follow and bumps the counter to 1.
    const first = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(first).toEqual({ established: true });

    // Second tap: both edges already exist, so nothing new is established — no lying success
    // toast, and no inflating the followsEstablished counter (S2).
    const second = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(second).toEqual({ established: false });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.followsEstablished).toBe(1);
  });

  test("token flow over a pending incoming request still notifies the target (S1)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Alice, now public, still has a pending INCOMING request from Bob from her private days.
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "pending",
        createdAt: Date.now(),
      });
    });

    // Bob taps Alice's QR — the token flow auto-approves the pending row WITHOUT Alice acting.
    await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
      token,
    });
    await flushScheduled(t);

    // Alice never clicked "approve", so the post-approval suppression must NOT eat her
    // new_follower: she gained Bob as a follower and deserves to learn it.
    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications.map((n) => n.type)).toEqual(["new_follower"]);
  });
});

// SEC-42: a token is forwardable, so holding a private member's code is not their consent. A scan
// of a private owner's code is exactly a follow request (what the Follow button would do), never
// a forced mutual follow, unless the owner already follows the scanner.
describe("acceptQrFollow on a private owner (SEC-42)", () => {
  const makePrivate = (t: TestConvex<typeof schema>, memberId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("profiles", {
        aggregateId: crypto.randomUUID(),
        memberId,
        visibility: "private",
        updatedAt: Date.now(),
      }),
    );

  const requestRows = (
    t: TestConvex<typeof schema>,
    requesterId: Id<"users">,
    targetId: Id<"users">,
  ) =>
    t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", requesterId).eq("targetId", targetId),
        )
        .collect(),
    );

  const followsEstablished = (t: TestConvex<typeof schema>, token: string) =>
    t.run(async (ctx) => {
      const link = await ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      return link?.followsEstablished;
    });

  const privateAliceToken = async (t: TestConvex<typeof schema>) => {
    const users = await seedUsers(t);
    await makePrivate(t, users.alice);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    return { ...users, token };
  };

  test("a scan sends a follow request: no edges, nothing approved, counter untouched", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false, requested: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
    expect((await requestRows(t, bob, alice)).map((r) => r.status)).toEqual([
      "pending",
    ]);
    expect(await requestRows(t, alice, bob)).toEqual([]);
    expect(await followsEstablished(t, token)).toBe(0);

    // Alice decides: she hears about a request, not about a new follower.
    await flushScheduled(t);
    expect((await notificationsFor(t, alice)).map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
  });

  test("a repeat scan over a pending request leaves it pending (never auto-approved)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false, requested: true });
    const rows = await requestRows(t, bob, alice);
    expect(rows.map((r) => r.status)).toEqual(["pending"]);
    expect(rows[0].approvedViaToken).toBeUndefined();
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
  });

  test("when the private owner already follows the scanner, the scan completes the mutual follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });
    expect(await requestRows(t, bob, alice)).toEqual([]);
    expect(await followsEstablished(t, token)).toBe(1);
  });

  test("an owner's decline inside the cooldown stays silent: reads as requested, nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    const declinedAt = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      }),
    );

    // Exactly what Bob's Follow button answers: the decline must not be probeable via a scan.
    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false, requested: true });
    const rows = await requestRows(t, bob, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("declined");
    expect(rows[0].respondedAt).toBe(declinedAt);
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
    await flushScheduled(t);
    expect(await notificationsFor(t, alice)).toEqual([]);
  });

  test("a scanner who declined the owner may still ask, like their Follow button; the decline stands", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    const declinedAt = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: alice,
        targetId: bob,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      }),
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false, requested: true });
    expect((await requestRows(t, bob, alice)).map((r) => r.status)).toEqual([
      "pending",
    ]);
    const aliceRequest = await requestRows(t, alice, bob);
    expect(aliceRequest.map((r) => [r.status, r.respondedAt])).toEqual([
      ["declined", declinedAt],
    ]);
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
  });

  test("an existing one-way follow (scanner already follows) changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    await t.run((ctx) =>
      ctx.db.insert("follows", {
        aggregateId: crypto.randomUUID(),
        followerId: bob,
        followeeId: alice,
        createdAt: Date.now(),
      }),
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: true });
    expect(await requestRows(t, bob, alice)).toEqual([]);
  });

  test.each([
    ["the owner blocked the scanner", "owner"],
    ["the scanner blocked the owner", "scanner"],
  ] as const)("%s: refused quietly, no rows", async (_, blocker) => {
    const t = convexTest(schema, modules);
    const { alice, bob, token } = await privateAliceToken(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: blocker === "owner" ? alice : bob,
        blockedId: blocker === "owner" ? bob : alice,
        createdAt: Date.now(),
      }),
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: false });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
    expect(await requestRows(t, bob, alice)).toEqual([]);
  });

  test("a public owner keeps the one-tap mutual follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        aggregateId: crypto.randomUUID(),
        memberId: alice,
        visibility: "public",
        updatedAt: Date.now(),
      }),
    );
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });
  });
});

describe("establishMutualFollow", () => {
  test("refuses with established:false / edgesCreated:0 when a decline is inside the cooldown", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);

    const declinedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      });
    });

    const result = await t.run((ctx) => establishMutualFollow(ctx, alice, bob));
    expect(result).toEqual({ established: false, edgesCreated: 0 });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
  });

  test("reports edgesCreated:2 for a fresh pair and edgesCreated:0 on a repeat", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);

    const first = await t.run((ctx) => establishMutualFollow(ctx, alice, bob));
    expect(first).toEqual({ established: true, edgesCreated: 2 });

    const second = await t.run((ctx) => establishMutualFollow(ctx, alice, bob));
    expect(second).toEqual({ established: true, edgesCreated: 0 });
  });
});
