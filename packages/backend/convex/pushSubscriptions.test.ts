import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUser = async (
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email,
      name: email,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const SUB = {
  endpoint: "https://push.example/abc",
  p256dh: "pkey",
  auth: "akey",
};

describe("push subscription registration", () => {
  test("registers a subscription owned by the authed member", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(
        api.notifications.pushSubscriptions.registerPushSubscription,
        SUB,
      );

    const rows = await t.run((ctx) =>
      ctx.db.query("pushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(alice);
    expect(rows[0].endpoint).toBe(SUB.endpoint);
    expect(rows[0].p256dh).toBe("pkey");
  });

  test("re-registering the same endpoint updates keys in place (no duplicate)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });

    await asAlice.mutation(
      api.notifications.pushSubscriptions.registerPushSubscription,
      SUB,
    );
    await asAlice.mutation(
      api.notifications.pushSubscriptions.registerPushSubscription,
      { ...SUB, p256dh: "rotated", auth: "rotated-auth" },
    );

    const rows = await t.run((ctx) =>
      ctx.db.query("pushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("rotated");
    expect(rows[0].auth).toBe("rotated-auth");
  });

  test("unregister removes only the caller's own subscription", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    await seedUser(t, "clerk_bob", "bob@example.com");

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(
        api.notifications.pushSubscriptions.registerPushSubscription,
        SUB,
      );

    // Bob can't delete Alice's subscription (different owner) — no-op.
    await t
      .withIdentity({ subject: "clerk_bob" })
      .mutation(
        api.notifications.pushSubscriptions.unregisterPushSubscription,
        { endpoint: SUB.endpoint },
      );
    expect(
      await t.run((ctx) => ctx.db.query("pushSubscriptions").collect()),
    ).toHaveLength(1);

    // Alice can.
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(
        api.notifications.pushSubscriptions.unregisterPushSubscription,
        { endpoint: SUB.endpoint },
      );
    expect(
      await t.run((ctx) => ctx.db.query("pushSubscriptions").collect()),
    ).toHaveLength(0);
  });

  test("requires auth to register", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(
        api.notifications.pushSubscriptions.registerPushSubscription,
        SUB,
      ),
    ).rejects.toThrow();
  });

  test("internal listForUser + prune", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(
        api.notifications.pushSubscriptions.registerPushSubscription,
        SUB,
      );

    const subs = await t.query(
      internal.notifications.pushSubscriptions.listSubscriptionsForUser,
      { userId: alice },
    );
    expect(subs).toHaveLength(1);

    await t.mutation(
      internal.notifications.pushSubscriptions.pruneSubscription,
      { id: subs[0]._id },
    );
    expect(
      await t.run((ctx) => ctx.db.query("pushSubscriptions").collect()),
    ).toHaveLength(0);
  });
});
