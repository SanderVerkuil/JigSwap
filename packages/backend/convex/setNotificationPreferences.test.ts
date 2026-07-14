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

describe("setNotificationPreferences", () => {
  test("applies a bulk update atomically", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);

    await asMember(t).mutation(
      api.notifications.setNotificationPreferences.setNotificationPreferences,
      {
        updates: [
          { type: "trade_request", channel: "email", enabled: true },
          { type: "trade_accepted", channel: "email", enabled: true },
        ],
      },
    );

    const prefs = await asMember(t).query(
      api.notifications.getMyPreferences.getMyPreferences,
      {},
    );
    expect(prefs["trade_request"]?.email).toBe(true);
    expect(prefs["trade_accepted"]?.email).toBe(true);
  });

  test("rejects more than 63 updates", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);

    const updates = Array.from({ length: 64 }, () => ({
      type: "trade_request" as const,
      channel: "email" as const,
      enabled: true,
    }));

    await expect(
      asMember(t).mutation(
        api.notifications.setNotificationPreferences.setNotificationPreferences,
        { updates },
      ),
    ).rejects.toThrow(/too many/i);
  });

  test("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);

    await expect(
      t.mutation(
        api.notifications.setNotificationPreferences.setNotificationPreferences,
        { updates: [] },
      ),
    ).rejects.toThrow();
  });
});
