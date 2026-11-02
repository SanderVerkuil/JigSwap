import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUser = async (
  t: TestConvex<typeof schema>,
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

// Base64url without padding, as PushSubscription.toJSON() emits it.
const b64url = (bytes: readonly number[]): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
// A key set: p256dh a 65-byte uncompressed point (0x04 first), auth 16 bytes.
const keysOf = (seed: number) => ({
  p256dh: b64url(Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : seed))),
  auth: b64url(Array.from({ length: 16 }, () => seed)),
});
const KEYS = keysOf(1);
const ROTATED = keysOf(2);

const fcm = (token: string) => `https://fcm.googleapis.com/fcm/send/${token}`;

const SUB = { endpoint: fcm("abc"), ...KEYS };

const subscriptionsOf = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("pushSubscriptions").collect());

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
    expect(rows[0].p256dh).toBe(KEYS.p256dh);
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
      { ...SUB, ...ROTATED },
    );

    const rows = await t.run((ctx) =>
      ctx.db.query("pushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe(ROTATED.p256dh);
    expect(rows[0].auth).toBe(ROTATED.auth);
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

describe("push subscription safety (SEC-16)", () => {
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error instanceof ConvexError
        ? (error.data as { code: string }).code
        : String(error);
    }
    return "ok";
  };

  test("refuses endpoints off the push services, and keeps nothing (NOTIF-1)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const endpoint of [
      "https://10.0.0.1:8443/internal",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      `https://tarpit.attacker.example/${"x".repeat(20_000)}`,
      // An allowlisted host doesn't excuse a 20 KB path.
      fcm("x".repeat(20_000)),
    ]) {
      expect(
        await codeOf(
          asAlice.mutation(
            api.notifications.pushSubscriptions.registerPushSubscription,
            { endpoint, ...KEYS },
          ),
        ),
        endpoint.slice(0, 60),
      ).toBe("InvalidPushSubscription");
    }
    expect(await subscriptionsOf(t)).toHaveLength(0);

    // The refusal logs the host, never the path (it would carry a device token).
    const lines = error.mock.calls.map((call) => String(call[0]));
    const refusal = lines.find((line) => line.includes("10.0.0.1"));
    expect(refusal).toContain('"endpoint_host":"10.0.0.1"');
    expect(refusal).not.toContain("internal");
    expect(lines.join("\n")).not.toContain("x".repeat(100));
    error.mockRestore();
  });

  test("refuses keys a push service could not encrypt to", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const keys of [
      { p256dh: "pkey", auth: KEYS.auth },
      { p256dh: KEYS.p256dh, auth: "akey" },
      { p256dh: "x".repeat(100_000), auth: KEYS.auth },
    ]) {
      expect(
        await codeOf(
          asAlice.mutation(
            api.notifications.pushSubscriptions.registerPushSubscription,
            { endpoint: fcm("abc"), ...keys },
          ),
        ),
      ).toBe("InvalidPushSubscription");
    }
    expect(await subscriptionsOf(t)).toHaveLength(0);
    error.mockRestore();
  });

  test("an eleventh subscription evicts the member's oldest", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const bob = await seedUser(t, "clerk_bob", "bob@example.com");
    // Ten devices already registered (seeded directly: the hourly limit is also ten).
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i += 1) {
        await ctx.db.insert("pushSubscriptions", {
          userId: alice,
          endpoint: fcm(`device-${i}`),
          ...KEYS,
          createdAt: 1_000 + i,
        });
      }
      await ctx.db.insert("pushSubscriptions", {
        userId: bob,
        endpoint: fcm("bob-device"),
        ...KEYS,
        createdAt: 500,
      });
    });

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.notifications.pushSubscriptions.registerPushSubscription, {
        endpoint: fcm("device-new"),
        ...KEYS,
      });

    const rows = await subscriptionsOf(t);
    const alices = rows
      .filter((row) => row.userId === alice)
      .map((row) => row.endpoint)
      .sort();
    expect(alices).toHaveLength(10);
    expect(alices).not.toContain(fcm("device-0"));
    expect(alices).toContain(fcm("device-new"));
    expect(alices).toContain(fcm("device-1"));
    // Another member's subscriptions are never counted or evicted.
    expect(rows.filter((row) => row.userId === bob)).toHaveLength(1);
  });

  test("re-registering a device at the cap evicts nothing", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i += 1) {
        await ctx.db.insert("pushSubscriptions", {
          userId: alice,
          endpoint: fcm(`device-${i}`),
          ...KEYS,
          createdAt: 1_000 + i,
        });
      }
    });

    // The oldest device re-subscribes (e.g. after a key rotation): it is kept, nothing is evicted.
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.notifications.pushSubscriptions.registerPushSubscription, {
        endpoint: fcm("device-0"),
        ...ROTATED,
      });

    const rows = await subscriptionsOf(t);
    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.endpoint === fcm("device-0"))?.p256dh).toBe(
      ROTATED.p256dh,
    );
  });

  test("a device taken over from another member counts toward the new owner's cap", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const bob = await seedUser(t, "clerk_bob", "bob@example.com");
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i += 1) {
        await ctx.db.insert("pushSubscriptions", {
          userId: alice,
          endpoint: fcm(`device-${i}`),
          ...KEYS,
          createdAt: 1_000 + i,
        });
      }
      // The shared device was registered (by Bob) before all of Alice's.
      await ctx.db.insert("pushSubscriptions", {
        userId: bob,
        endpoint: fcm("shared"),
        ...KEYS,
        createdAt: 1,
      });
    });

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.notifications.pushSubscriptions.registerPushSubscription, {
        endpoint: fcm("shared"),
        ...KEYS,
      });

    const alices = (await subscriptionsOf(t))
      .filter((row) => row.userId === alice)
      .map((row) => row.endpoint);
    expect(alices).toHaveLength(10);
    // The device just registered stays, however old its row; her oldest other device goes.
    expect(alices).toContain(fcm("shared"));
    expect(alices).not.toContain(fcm("device-0"));
  });

  test("registrations are rate limited per member", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    await seedUser(t, "clerk_bob", "bob@example.com");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 10; i += 1) {
      await asAlice.mutation(
        api.notifications.pushSubscriptions.registerPushSubscription,
        { endpoint: fcm(`device-${i}`), ...KEYS },
      );
    }
    expect(
      await codeOf(
        asAlice.mutation(
          api.notifications.pushSubscriptions.registerPushSubscription,
          { endpoint: fcm("device-10"), ...KEYS },
        ),
      ),
    ).toBe("RateLimited");
    expect(await subscriptionsOf(t)).toHaveLength(10);

    // Another member has their own budget.
    await t
      .withIdentity({ subject: "clerk_bob" })
      .mutation(api.notifications.pushSubscriptions.registerPushSubscription, {
        endpoint: fcm("bob"),
        ...KEYS,
      });
    expect(await subscriptionsOf(t)).toHaveLength(11);
    error.mockRestore();
  });
});

// SEC-54: the member's own device list (no endpoint or keys ever leave the server) and remote
// revoke, so a push subscription left on a shared browser can be cut off from anywhere.
describe("push device list and revoke", () => {
  const CHROME = {
    endpoint: "https://fcm.googleapis.com/fcm/send/chrome-token",
    p256dh: "chrome-p256dh",
    auth: "chrome-auth",
  };
  const FIREFOX = {
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/ff-token",
    p256dh: "ff-p256dh",
    auth: "ff-auth",
  };
  const BOB_SAFARI = {
    endpoint: "https://web.push.apple.com/bob-token",
    p256dh: "bob-p256dh",
    auth: "bob-auth",
  };

  const seedSubscription = async (
    t: TestConvex<typeof schema>,
    userId: Id<"users">,
    sub: typeof SUB,
    createdAt: number,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("pushSubscriptions", { userId, ...sub, createdAt }),
    );

  test("lists only the caller's devices, newest first, marking the current one, without endpoints or keys", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const bob = await seedUser(t, "clerk_bob", "bob@example.com");
    const chromeId = await seedSubscription(t, alice, CHROME, 1_000);
    const firefoxId = await seedSubscription(t, alice, FIREFOX, 2_000);
    await seedSubscription(t, bob, BOB_SAFARI, 3_000);

    const devices = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.notifications.pushSubscriptions.listMyPushDevices, {
        currentEndpoint: CHROME.endpoint,
      });

    expect(devices).toEqual([
      { id: firefoxId, service: "firefox", createdAt: 2_000, current: false },
      { id: chromeId, service: "chrome", createdAt: 1_000, current: true },
    ]);
    const serialized = JSON.stringify(devices);
    for (const secret of [
      CHROME.endpoint,
      CHROME.p256dh,
      CHROME.auth,
      FIREFOX.endpoint,
      FIREFOX.p256dh,
      FIREFOX.auth,
      "fcm.googleapis.com",
      "mozilla.com",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("marks nothing current without a current endpoint, and names each push service", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const services = [
      ["https://fcm.googleapis.com/fcm/send/a", "chrome"],
      ["https://updates.push.services.mozilla.com/wpush/v2/b", "firefox"],
      ["https://web.push.apple.com/c", "safari"],
      ["https://wns2-am3p.notify.windows.com/w/?token=d", "edge"],
      ["https://android.googleapis.com/gcm/send/f", "chrome"],
      ["https://push.example/e", "other"],
      ["not a url", "other"],
    ] as const;
    for (const [index, [endpoint]] of services.entries()) {
      await seedSubscription(t, alice, { ...SUB, endpoint }, index);
    }

    const devices = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.notifications.pushSubscriptions.listMyPushDevices, {});

    expect(devices.map((device) => [device.service, device.current])).toEqual(
      services.map(([, service]) => [service, false]).reverse(),
    );
  });

  test("the current flag never matches another member's endpoint", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "clerk_alice", "alice@example.com");
    const bob = await seedUser(t, "clerk_bob", "bob@example.com");
    await seedSubscription(t, bob, BOB_SAFARI, 1_000);

    const devices = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.notifications.pushSubscriptions.listMyPushDevices, {
        currentEndpoint: BOB_SAFARI.endpoint,
      });
    expect(devices).toEqual([]);
  });

  test("revoke deletes the caller's own device only", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const bob = await seedUser(t, "clerk_bob", "bob@example.com");
    const chromeId = await seedSubscription(t, alice, CHROME, 1_000);
    const firefoxId = await seedSubscription(t, alice, FIREFOX, 2_000);
    const bobId = await seedSubscription(t, bob, BOB_SAFARI, 3_000);

    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    await asAlice.mutation(
      api.notifications.pushSubscriptions.revokePushDevice,
      { id: chromeId },
    );
    // Bob's id and a malformed id are both no-ops, not errors.
    await asAlice.mutation(
      api.notifications.pushSubscriptions.revokePushDevice,
      { id: bobId },
    );
    await asAlice.mutation(
      api.notifications.pushSubscriptions.revokePushDevice,
      { id: "not-an-id" },
    );

    const remaining = await t.run((ctx) =>
      ctx.db.query("pushSubscriptions").collect(),
    );
    expect(remaining.map((row) => row._id).sort()).toEqual(
      [firefoxId, bobId].sort(),
    );
  });

  test("both require a signed-in member", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedUser(t, "clerk_alice", "alice@example.com");
    const chromeId = await seedSubscription(t, alice, CHROME, 1_000);

    await expect(
      t.query(api.notifications.pushSubscriptions.listMyPushDevices, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.notifications.pushSubscriptions.revokePushDevice, {
        id: chromeId,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    expect(
      await t.run((ctx) => ctx.db.query("pushSubscriptions").collect()),
    ).toHaveLength(1);
  });
});
