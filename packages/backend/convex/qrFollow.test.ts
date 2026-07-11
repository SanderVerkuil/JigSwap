import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
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

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

const followEdges = (
  t: ReturnType<typeof convexTest>,
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

  test("auto-approves a pending follow request between the pair", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob has a pending request to (private) Alice — Phase 2 shape
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
});
