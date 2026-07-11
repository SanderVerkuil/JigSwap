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

describe("getInviteContext", () => {
  test("valid only when token is active AND belongs to the viewed member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Unauthenticated (public) query
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: alice,
      }),
    ).toEqual({ valid: true });

    // Token pinned to a different member's profile -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: bob,
      }),
    ).toEqual({ valid: false });

    // Unknown token -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token: "nope",
        memberId: alice,
      }),
    ).toEqual({ valid: false });

    // Revoked token -> invalid
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: alice,
      }),
    ).toEqual({ valid: false });
  });
});

describe("recordInviteLanding", () => {
  test("increments landingViews for valid tokens, no-ops otherwise", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Public (unauthenticated) mutation
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token,
    });
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token,
    });
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token: "nope",
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(row?.landingViews).toBe(2);
  });
});
