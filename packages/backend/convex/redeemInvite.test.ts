import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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
});
