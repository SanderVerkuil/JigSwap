import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  EMAIL_UNSUBSCRIBE_PATH,
  emailUnsubscribeTokenOf,
  emailUnsubscribeUrlOf,
} from "./notifications/unsubscribeToken";
import schema from "./schema";

// One-click List-Unsubscribe (SEC-84, RFC 8058). Every notification email to a member carries a
// signed link that turns off that one type's email for them: a mail provider POSTs it, and a GET
// (a link scanner, or a client that opens the link) only redirects to the preferences page.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const SECRET = "test-only-email-unsubscribe-secret-0123456789";
const SITE = "https://happy-otter-123.convex.site";
const now = Date.now();

const mkUser = (t: T, clerkId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }),
  );

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

// Email is off by default; switch the two types this suite watches on for a member.
const enableEmail = async (t: T, clerkId: string) => {
  for (const type of ["new_follower", "trade_request"] as const) {
    await as(t, clerkId).mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type, channel: "email", enabled: true },
    );
  }
};

const emailToggles = async (t: T, clerkId: string) => {
  const toggles = await as(t, clerkId).query(
    api.notifications.getMyPreferences.getMyPreferences,
    {},
  );
  return {
    newFollower: toggles.new_follower.email,
    tradeRequest: toggles.trade_request.email,
  };
};

const seed = async () => {
  const t = convexTest(schema, modules);
  const anna = await mkUser(t, "anna");
  const bob = await mkUser(t, "bob");
  await enableEmail(t, "anna");
  await enableEmail(t, "bob");
  return { t, anna, bob };
};

// The path and query of a full unsubscribe URL, for t.fetch.
const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

const urlFor = async (userId: Id<"users">, type: string): Promise<string> => {
  const url = await emailUnsubscribeUrlOf(
    { EMAIL_UNSUBSCRIBE_SECRET: SECRET, CONVEX_SITE_URL: SITE },
    userId,
    type,
  );
  if (url === undefined) throw new Error("expected an unsubscribe URL");
  return url;
};

// What a mail provider sends for a one-click unsubscribe (RFC 8058 section 3.2).
const oneClick = (t: T, path: string) =>
  t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });

const withToken = (token: string) =>
  `${EMAIL_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("EMAIL_BASE_URL", "https://jigswap.site");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("emailUnsubscribeUrlOf", () => {
  test("links the deployment's unsubscribe route with a signed token", async () => {
    const url = new URL(await urlFor("user123" as Id<"users">, "new_follower"));
    expect(url.origin).toBe(SITE);
    expect(url.pathname).toBe(EMAIL_UNSUBSCRIBE_PATH);
    expect(url.searchParams.get("token")).toMatch(
      /^v1\.user123\.new_follower\.[A-Za-z0-9_-]{43}$/,
    );
  });

  test("is off without a long enough secret, without an https site URL, or for a type that is never emailed", async () => {
    const off = [
      { CONVEX_SITE_URL: SITE },
      { EMAIL_UNSUBSCRIBE_SECRET: "too-short", CONVEX_SITE_URL: SITE },
      { EMAIL_UNSUBSCRIBE_SECRET: SECRET },
      { EMAIL_UNSUBSCRIBE_SECRET: SECRET, CONVEX_SITE_URL: "http://x.site" },
    ];
    for (const env of off) {
      expect(await emailUnsubscribeUrlOf(env, "u1", "new_follower")).toBe(
        undefined,
      );
    }
    expect(
      await emailUnsubscribeUrlOf(
        { EMAIL_UNSUBSCRIBE_SECRET: SECRET, CONVEX_SITE_URL: SITE },
        "u1",
        "whats_new",
      ),
    ).toBe(undefined);
  });
});

describe("POST /email/unsubscribe (one-click)", () => {
  test("turns off that type's email for that member only", async () => {
    const { t, anna } = await seed();
    const response = await oneClick(
      t,
      pathOf(await urlFor(anna, "new_follower")),
    );
    expect(response.status).toBe(200);
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: false,
      tradeRequest: true,
    });
    expect(await emailToggles(t, "bob")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
  });

  test("is idempotent: a second click answers 200 and changes nothing more", async () => {
    const { t, anna } = await seed();
    const path = pathOf(await urlFor(anna, "new_follower"));
    expect((await oneClick(t, path)).status).toBe(200);
    expect((await oneClick(t, path)).status).toBe(200);
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: false,
      tradeRequest: true,
    });
  });

  test("refuses a tampered, re-targeted, missing or foreign-key token with 400", async () => {
    const { t, anna, bob } = await seed();
    const token = await emailUnsubscribeTokenOf(SECRET, anna, "new_follower");
    const [version, , type, signature] = token.split(".");
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    const refused = [
      // Anna's signature on Bob's id: one member can't unsubscribe another.
      withToken(`${version}.${bob}.${type}.${signature}`),
      // Anna's signature on another type.
      withToken(`${version}.${anna}.trade_request.${signature}`),
      withToken(`${version}.${anna}.${type}.${flipped}`),
      withToken(`v2.${anna}.${type}.${signature}`),
      withToken(await emailUnsubscribeTokenOf(`${SECRET}-other`, anna, type)),
      withToken("garbage"),
      EMAIL_UNSUBSCRIBE_PATH,
    ];
    for (const path of refused) {
      expect((await oneClick(t, path)).status).toBe(400);
    }
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
    expect(await emailToggles(t, "bob")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
  });

  test("a valid link for a deactivated account answers 200 and writes nothing", async () => {
    const { t, anna } = await seed();
    const path = pathOf(await urlFor(anna, "new_follower"));
    await t.run((ctx) => ctx.db.patch(anna, { isActive: false }));
    expect((await oneClick(t, path)).status).toBe(200);
    await t.run((ctx) => ctx.db.patch(anna, { isActive: true }));
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
  });

  test("answers 503 and changes nothing when the deployment has no secret", async () => {
    const { t, anna } = await seed();
    const path = pathOf(await urlFor(anna, "new_follower"));
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", undefined);
    expect((await oneClick(t, path)).status).toBe(503);
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
  });
});

describe("GET /email/unsubscribe", () => {
  test("only redirects to the preferences page, so a link scanner unsubscribes nobody", async () => {
    const { t, anna } = await seed();
    const response = await t.fetch(pathOf(await urlFor(anna, "new_follower")), {
      method: "GET",
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://jigswap.site/notifications/preferences",
    );
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: true,
      tradeRequest: true,
    });
  });
});

describe("sendEmail", () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: [] }), { status: 202 }),
  );
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AHASEND_API_KEY", "aha-sk-test");
    vi.stubEnv("AHASEND_ACCOUNT_ID", "acc-1");
  });

  const send = (t: T, userId: Id<"users"> | undefined) =>
    t.action(internal.notifications.sendEmail.send, {
      to: "anna@example.com",
      toName: "anna",
      type: "new_follower",
      params: { actorName: "Mara" },
      locale: "en",
      idempotencyKey: "notif-unsub",
      ...(userId !== undefined ? { userId } : {}),
    });

  const sentHeaders = (): Record<string, string> | undefined => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    return (
      JSON.parse(init.body as string) as {
        headers?: Record<string, string>;
      }
    ).headers;
  };

  test("adds the one-click headers, and the link unsubscribes the recipient", async () => {
    const { t, anna } = await seed();
    await send(t, anna);
    const headers = sentHeaders();
    expect(headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    const link = /^<(https:\/\/[^>]+)>$/.exec(
      headers?.["List-Unsubscribe"] ?? "",
    );
    expect(link?.[1].startsWith(`${SITE}${EMAIL_UNSUBSCRIBE_PATH}?`)).toBe(
      true,
    );
    expect((await oneClick(t, pathOf(link?.[1] ?? ""))).status).toBe(200);
    expect(await emailToggles(t, "anna")).toEqual({
      newFollower: false,
      tradeRequest: true,
    });
  });

  test("sends no List-Unsubscribe header without the secret, or for a payload without its recipient", async () => {
    const { t, anna } = await seed();
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", undefined);
    await send(t, anna);
    expect(sentHeaders()).toBe(undefined);

    fetchMock.mockClear();
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
    await send(t, undefined);
    expect(sentHeaders()).toBe(undefined);
  });
});
