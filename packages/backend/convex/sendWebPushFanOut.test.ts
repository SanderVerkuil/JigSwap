import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-16: the push action sends to a member's subscriptions in parallel, each with a socket
// timeout, and only to allowlisted push services (rows stored before registration was validated
// may point anywhere), at most the newest MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER.

// web-push signs and POSTs over https; replace it so the sends can be inspected.
const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(
    async (
      _sub: { endpoint: string },
      _payload: string,
      _options?: { timeout?: number },
    ): Promise<{ statusCode: number }> => ({ statusCode: 201 }),
  ),
}));
vi.mock("web-push", () => ({ default: webPushMock }));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const fcm = (token: string) => `https://fcm.googleapis.com/fcm/send/${token}`;

const seedMember = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: 0,
      updatedAt: 0,
    }),
  );

// Rows inserted directly, as legacy rows (or rows from before validation) would be.
const seedSubscriptions = (
  t: T,
  userId: Id<"users">,
  endpoints: readonly string[],
) =>
  t.run(async (ctx) => {
    for (const [i, endpoint] of endpoints.entries()) {
      await ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint,
        p256dh: "p",
        auth: "a",
        createdAt: 1_000 + i,
      });
    }
  });

const send = (t: T, userId: Id<"users">) =>
  t.action(internal.notifications.sendWebPush.send, {
    userId,
    type: "new_follower",
    title: "New follower",
    message: "Bob started following you",
  });

const sentEndpoints = () =>
  webPushMock.sendNotification.mock.calls.map(([sub]) => sub.endpoint).sort();

const endpointsLeft = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("pushSubscriptions").collect())
      .map((row) => row.endpoint)
      .sort(),
  );

describe("sendWebPush fan-out (SEC-16)", () => {
  beforeEach(() => {
    webPushMock.sendNotification.mockReset();
    webPushMock.sendNotification.mockImplementation(async () => ({
      statusCode: 201,
    }));
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("every send carries a 10 s socket timeout", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedSubscriptions(t, alice, [fcm("a"), fcm("b")]);

    await send(t, alice);

    expect(webPushMock.sendNotification).toHaveBeenCalledTimes(2);
    for (const call of webPushMock.sendNotification.mock.calls) {
      expect(call[2]).toMatchObject({ timeout: 10_000 });
    }
  });

  test("sends to all subscriptions in parallel, not one after another", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedSubscriptions(t, alice, [fcm("a"), fcm("b"), fcm("c")]);
    let inFlight = 0;
    let maxInFlight = 0;
    webPushMock.sendNotification.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { statusCode: 201 };
    });

    await send(t, alice);

    expect(webPushMock.sendNotification).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(3);
  });

  test("skips a stored endpoint off the push services, without deleting it", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const legacy = [
      "https://10.0.0.1:8443/internal",
      "https://tarpit.attacker.example/x",
    ];
    await seedSubscriptions(t, alice, [...legacy, fcm("a")]);

    await send(t, alice);

    expect(sentEndpoints()).toEqual([fcm("a")]);
    expect(await endpointsLeft(t)).toEqual([...legacy, fcm("a")].sort());
  });

  test("sends to the newest ten subscriptions at most", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const endpoints = Array.from({ length: 13 }, (_, i) => fcm(`d${i}`));
    await seedSubscriptions(t, alice, endpoints);

    await send(t, alice);

    // createdAt grows with the index, so the three oldest (d0..d2) are left out.
    expect(sentEndpoints()).toEqual(endpoints.slice(3).sort());
  });

  test("prunes a gone subscription and keeps one that failed for now", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedSubscriptions(t, alice, [fcm("gone"), fcm("flaky"), fcm("ok")]);
    webPushMock.sendNotification.mockImplementation(async (sub) => {
      if (sub.endpoint === fcm("gone")) {
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      }
      if (sub.endpoint === fcm("flaky")) {
        throw Object.assign(new Error("Socket timeout"), { statusCode: null });
      }
      return { statusCode: 201 };
    });

    await send(t, alice);

    expect(webPushMock.sendNotification).toHaveBeenCalledTimes(3);
    expect(await endpointsLeft(t)).toEqual([fcm("flaky"), fcm("ok")].sort());
  });
});
