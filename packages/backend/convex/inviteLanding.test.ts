import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { inviteLandingBudget } from "./lib/rateLimits";
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

// Wide events are JSON lines: info on console.log, error on console.error.
const captureLogs = () => {
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const eventsOf = (spy: typeof info) =>
    spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );
  return { info: () => eventsOf(info), error: () => eventsOf(error) };
};

const asAlice = (t: TestConvex<typeof schema>) =>
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
    ).toEqual({ valid: true, kind: "network" });

    // Token pinned to a different member's profile -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: bob,
      }),
    ).toEqual({ valid: false, kind: "network" });

    // Unknown token -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token: "nope",
        memberId: alice,
      }),
    ).toEqual({ valid: false, kind: "network" });

    // Revoked token -> invalid
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: alice,
      }),
    ).toEqual({ valid: false, kind: "network" });
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

describe("recordInviteLanding budget (SEC-82)", () => {
  const land = (t: TestConvex<typeof schema>, token: string) =>
    t.mutation(api.social.recordInviteLanding.recordInviteLanding, { token });

  const linkOf = (t: TestConvex<typeof schema>, token: string) =>
    t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );

  test("counts at most the link's hourly budget, then again the next hour", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const link = await linkOf(t, token);
    const [budget] = inviteLandingBudget(link!._id);

    // Landings past the budget are accepted but not counted, and write nothing.
    for (let i = 0; i < budget.cap + 5; i++) await land(t, token);
    expect((await linkOf(t, token))?.landingViews).toBe(budget.cap);

    // Age the link's window past its length: the next landing counts again.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", budget.key))
        .unique();
      await ctx.db.patch(row!._id, {
        windowStart: row!.windowStart - budget.windowMs,
      });
    });
    await land(t, token);
    expect((await linkOf(t, token))?.landingViews).toBe(budget.cap + 1);
  });

  test("unknown and revoked tokens still write nothing", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});

    await land(t, "nope");
    await land(t, token);
    expect((await linkOf(t, token))?.landingViews).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.query("rateLimits").collect()),
    ).toHaveLength(0);
  });

  test("landings past the budget log no error line", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const link = await linkOf(t, token);
    const [budget] = inviteLandingBudget(link!._id);
    const logs = captureLogs();
    for (let i = 0; i < budget.cap + 30; i++) await land(t, token);

    expect(logs.error()).toEqual([]);
    expect((await linkOf(t, token))?.landingViews).toBe(budget.cap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
