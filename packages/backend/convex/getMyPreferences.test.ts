import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedMember = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "clerk_alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("getMyPreferences", () => {
  test("resolves a stored row that only has one type entry into the full resolved map", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        aggregateId: "pref_alice",
        memberId,
        // Only one type stored, and (synthetically) only its email channel: pins the per-channel
        // fallback mechanism for absent keys; persisted entries have always been full triples.
        toggles: { trade_request: { email: true } },
        updatedAt: Date.now(),
      });
    });

    const prefs = await asMember(t).query(
      api.notifications.getMyPreferences.getMyPreferences,
      {},
    );

    expect(Object.keys(prefs)).toHaveLength(21);
    // The stored email wins; the absent inApp key falls back to its default (true).
    expect(prefs.trade_request).toEqual({
      inApp: true,
      email: true,
      push: false,
    });
    // A type never in the stored row resolves to the plain default triple.
    expect(prefs.goal_achieved).toEqual({
      inApp: true,
      email: false,
      push: false,
    });
  });
});
