import { COOLDOWN_MS } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

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

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asNewbie = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_newbie" });

const mutualEdges = (
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

const offersBetween = (
  t: TestConvex<typeof schema>,
  fromId: Id<"users">,
  toId: Id<"users">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("connectionOffers")
      .withIndex("by_from_to_status", (q) =>
        q.eq("fromId", fromId).eq("toId", toId),
      )
      .collect(),
  );

const linkFor = (t: TestConvex<typeof schema>, token: string) =>
  t.run((ctx) =>
    ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
  );

describe("redeemInvite", () => {
  test("first redemption attributes signup and offers a connection, following nobody yet", async () => {
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
    expect(result).toEqual({
      redeemed: true,
      inviterId: alice,
      connection: "pending",
    });

    // Confirm-first: no follow edge in either direction until the new member accepts.
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });

    const link = await linkFor(t, token);
    const offers = await offersBetween(t, alice, newbie);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      fromId: alice,
      toId: newbie,
      source: "inviteLink",
      inviteLinkId: link?._id,
      status: "pending",
    });
    expect(offers[0].expiresAt - offers[0].createdAt).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(link?.signupsAttributed).toBe(1);
    // followsEstablished waits for the accept.
    expect(link?.followsEstablished).toBe(0);
  });

  test("second redemption by the same member is a no-op (idempotent)", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
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

    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    // One offer per pair.
    expect(await offersBetween(t, alice, newbie)).toHaveLength(1);
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

  test("a forwarded token cannot bypass a declined-in-cooldown request (no offer, no edge)", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // redeemInvite is normally new-member-only, but Convex mutations are PUBLIC endpoints: an
    // existing member holding a forwarded token could call it directly. Here "newbie" stands in
    // for that existing member who asked to follow private Alice and was DECLINED, still inside
    // the cooldown. The link must not even offer the connection.
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
    // Redemption ledger + signup attribution still recorded (idempotency), but NO offer, NO
    // mutual edge and NO followsEstablished bump — so no mutual follow, which is exactly what
    // gates access to Alice's private profile (areMutualFollowers stays false).
    expect(result).toEqual({
      redeemed: true,
      inviterId: alice,
      connection: "skipped",
    });
    expect(await offersBetween(t, alice, newbie)).toEqual([]);
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

  test("once the decline cooldown has expired, the same token offers the connection", async () => {
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
    expect(result).toEqual({
      redeemed: true,
      inviterId: alice,
      connection: "pending",
    });
    expect(await offersBetween(t, alice, newbie)).toHaveLength(1);
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });

    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(0);
  });

  test("an existing (old) account cannot redeem — no attribution, no offer, no follow (S1b)", async () => {
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

    // No ledger row, no counters, no offer, no follow.
    const ledger = await t.run((ctx) =>
      ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", newbie))
        .unique(),
    );
    expect(ledger).toBeNull();
    expect(await offersBetween(t, alice, newbie)).toEqual([]);
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

    // 2. redeemInvite then runs on first dashboard visit. They already follow each other, so
    //    no offer is made and followsEstablished is NOT bumped again (signup is still attributed).
    const redeemed = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(redeemed).toEqual({
      redeemed: true,
      inviterId: alice,
      connection: "skipped",
    });
    expect(await offersBetween(t, alice, newbie)).toEqual([]);

    expect(await mutualEdges(t, alice, newbie)).toEqual({ ab: true, ba: true });
    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(1);
  });
});
