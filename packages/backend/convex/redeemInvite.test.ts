import { COOLDOWN_MS } from "@jigswap/domain";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    const newbie = await ctx.db.insert("users", {
      clerkId: "clerk_newbie",
      email: "newbie@example.com",
      name: "Newbie",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, newbie };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asNewbie = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_newbie" });

const mutualEdges = (
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

const linkFor = (t: ReturnType<typeof convexTest>, token: string) =>
  t.run((ctx) =>
    ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
  );

describe("redeemInvite", () => {
  test("first redemption attributes signup and establishes the mutual follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    const result = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(result).toEqual({ redeemed: true, inviterId: alice });

    const edges = await t.run(async (ctx) => {
      const ab = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", alice).eq("followeeId", newbie),
        )
        .unique();
      const ba = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", newbie).eq("followeeId", alice),
        )
        .unique();
      return { ab: ab !== null, ba: ba !== null };
    });
    expect(edges).toEqual({ ab: true, ba: true });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(1);
  });

  test("second redemption by the same member is a no-op (idempotent)", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    await asNewbie(t).mutation(api.social.redeemInvite.redeemInvite, {
      token,
    });
    const second = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(second).toEqual({ redeemed: false });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.signupsAttributed).toBe(1);
  });

  test("revoked and self tokens are no-ops", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Self token
    expect(
      await asAlice(t).mutation(api.social.redeemInvite.redeemInvite, {
        token,
      }),
    ).toEqual({ redeemed: false });

    // Revoked token
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await asNewbie(t).mutation(api.social.redeemInvite.redeemInvite, {
        token,
      }),
    ).toEqual({ redeemed: false });
  });

  test("a forwarded token cannot bypass a declined-in-cooldown request (no mutual edge)", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // redeemInvite is normally new-member-only, but Convex mutations are PUBLIC endpoints: an
    // existing member holding a forwarded token could call it directly. Here "newbie" stands in
    // for that existing member who asked to follow private Alice and was DECLINED, still inside
    // the cooldown. The structural gate in establishMutualFollow must refuse the follow.
    const declinedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: newbie,
        targetId: alice,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      });
    });

    const result = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    // Redemption ledger + signup attribution still recorded (idempotency), but NO mutual edge and
    // NO followsEstablished bump — so no mutual follow, which is exactly what gates access to
    // Alice's private profile (areMutualFollowers stays false).
    expect(result).toEqual({ redeemed: true, inviterId: alice });
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });

    // The declined row is untouched (still blocking).
    const request = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", newbie).eq("targetId", alice),
        )
        .unique(),
    );
    expect(request?.status).toBe("declined");
    expect(request?.respondedAt).toBe(declinedAt);

    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(0);
  });

  test("once the decline cooldown has expired, the same token establishes the follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Decline whose cooldown has already elapsed no longer protects anyone.
    const expiredAt = Date.now() - COOLDOWN_MS - 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: newbie,
        targetId: alice,
        status: "declined",
        createdAt: expiredAt,
        respondedAt: expiredAt,
      });
    });

    const result = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(result).toEqual({ redeemed: true, inviterId: alice });
    expect(await mutualEdges(t, alice, newbie)).toEqual({ ab: true, ba: true });

    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(1);
  });

  test("an existing (old) account cannot redeem — no attribution, no follow (S1b)", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // "newbie" is actually an OLD account here (logged out, opened the invite, logged back in):
    // its createdAt is well outside the new-member window, so redemption must no-op entirely.
    await t.run(async (ctx) => {
      await ctx.db.patch(newbie, {
        createdAt: Date.now() - 16 * 60 * 1000,
      });
    });

    const result = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(result).toEqual({ redeemed: false });

    // No ledger row, no counters, no follow.
    const ledger = await t.run((ctx) =>
      ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", newbie))
        .unique(),
    );
    expect(ledger).toBeNull();
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(0);
    expect(link?.followsEstablished).toBe(0);
  });

  test("accept-then-redeem: the natural new-member sequence bumps followsEstablished exactly once (S4)", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // 1. New member taps QrFollowPrompt on the return landing → acceptQrFollow creates the edges
    //    and bumps the counter to 1.
    const accepted = await asNewbie(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(accepted).toEqual({ established: true });

    // 2. redeemInvite then runs on first dashboard visit. The edges already exist, so
    //    edgesCreated is 0 and it must NOT bump followsEstablished again (signup is still attributed).
    const redeemed = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(redeemed).toEqual({ redeemed: true, inviterId: alice });

    expect(await mutualEdges(t, alice, newbie)).toEqual({ ab: true, ba: true });
    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(1);
  });
});
