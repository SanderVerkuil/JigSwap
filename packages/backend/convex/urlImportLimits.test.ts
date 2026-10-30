import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// URL import (catalog/extractFromUrl) runs outbound fetches and, when the cheap tiers fail or
// find no image, a paid Firecrawl scrape on the server's key (SEC-21). Only an active member may
// start one, each member has an hourly and a daily import bucket (admins exempt), and every
// Firecrawl scrape is charged to a deployment-wide budget first. No network: DNS and fetch are
// stubbed, the shop refusing both cheap tiers (403) and Firecrawl answering 402.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const SHOP = "attacker-shop.com";
const FIRECRAWL = "api.firecrawl.dev";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  vi.stubEnv("FIRECRAWL_HOURLY_CAP", "");
  vi.stubEnv("FIRECRAWL_DAILY_CAP", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hostOf = (input: RequestInfo | URL) =>
  new URL(input instanceof Request ? input.url : String(input)).hostname;

// The shop answers every cheap-tier fetch with `shop()`; Firecrawl always says 402.
const stubFetch = (
  shop: () => Response = () => new Response("", { status: 403 }),
) => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) =>
      hostOf(input) === FIRECRAWL
        ? new Response("payment required", { status: 402 })
        : shop(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls: (host: string) =>
      fetchMock.mock.calls.filter(([input]) => hostOf(input) === host).length,
    total: () => fetchMock.mock.calls.length,
  };
};

const seedMember = (
  t: TestConvex<typeof schema>,
  clerkId: string,
  isActive = true,
) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const seedBucket = (t: TestConvex<typeof schema>, key: string, count: number) =>
  t.run((ctx) =>
    ctx.db.insert("rateLimits", { key, windowStart: Date.now(), count }),
  );

const buckets = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("rateLimits").collect()).map((row) => [
        row.key,
        row.count,
      ]),
    ),
  );

type Caller = Pick<
  ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  "action"
>;

const extract = (caller: Caller, i: number) =>
  caller.action(api.catalog.extractFromUrl.extractFromUrl, {
    url: `https://${SHOP}/403?i=${i}`,
  });

const errorData = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data : String(error);
  }
  throw new Error("expected a refusal");
};

describe("extractFromUrl: who may import", () => {
  test.each([
    ["a signed-out caller", null],
    ["a signed-in caller without a member row", "none"],
    ["a deactivated member", "deactivated"],
  ] as const)("%s is refused before any fetch", async (_name, member) => {
    const fetches = stubFetch();
    const t = convexTest(schema, modules);
    if (member === "deactivated") await seedMember(t, "clerk_gone", false);
    const caller =
      member === null ? t : t.withIdentity({ subject: "clerk_gone" });

    await expect(extract(caller, 0)).rejects.toThrow(
      member === null ? /Unauthenticated/ : /Member not found/,
    );

    expect(fetches.total()).toBe(0);
    expect(await buckets(t)).toEqual({});
  });
});

describe("extractFromUrl: per-member limit", () => {
  test("the review's loop: 30 imports spend at most the Firecrawl budget, and the 31st is refused before any fetch", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    const fetches = stubFetch();
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });

    for (let i = 0; i < 30; i++) {
      expect(await extract(asAlice, i)).toEqual({
        ok: false,
        code: "FetchFailed",
      });
    }
    // ogie and the browser tier per call; Firecrawl only while the hourly budget (20) lasts.
    expect(fetches.calls(SHOP)).toBe(60);
    expect(fetches.calls(FIRECRAWL)).toBe(20);

    const refusal = await errorData(extract(asAlice, 30));
    expect(refusal).toMatchObject({ code: "RateLimited" });
    expect((refusal as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(
      0,
    );
    expect(fetches.total()).toBe(80);
    expect(await buckets(t)).toEqual({
      [`urlImport:${alice}`]: 30,
      [`urlImportDaily:${alice}`]: 30,
      "firecrawl:global:hour": 20,
      "firecrawl:global:day": 20,
    });
  });

  test("the daily bucket holds a member to 150 imports a day", async () => {
    const fetches = stubFetch();
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");
    await seedBucket(t, `urlImportDaily:${alice}`, 150);

    expect(
      await errorData(extract(t.withIdentity({ subject: "clerk_alice" }), 0)),
    ).toMatchObject({ code: "RateLimited" });
    expect(fetches.total()).toBe(0);
  });

  test("admins are not held to the per-member limit", async () => {
    const fetches = stubFetch();
    const t = convexTest(schema, modules);
    const admin = await seedMember(t, "clerk_admin");
    await seedBucket(t, `urlImport:${admin}`, 30);
    await seedBucket(t, `urlImportDaily:${admin}`, 150);

    expect(
      await extract(
        t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } }),
        0,
      ),
    ).toEqual({ ok: false, code: "FetchFailed" });

    expect(fetches.calls(SHOP)).toBe(2);
    // Nothing charged: not the member buckets, and no Firecrawl budget without an API key.
    expect(await buckets(t)).toEqual({
      [`urlImport:${admin}`]: 30,
      [`urlImportDaily:${admin}`]: 150,
    });
  });
});

describe("extractFromUrl: deployment-wide Firecrawl budget", () => {
  test("with FIRECRAWL_DAILY_CAP=2 the third fall-through makes no Firecrawl request", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubEnv("FIRECRAWL_DAILY_CAP", "2");
    const fetches = stubFetch();
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });

    for (let i = 0; i < 3; i++) {
      expect(await extract(asAlice, i)).toEqual({
        ok: false,
        code: "FetchFailed",
      });
    }

    expect(fetches.calls(SHOP)).toBe(6);
    expect(fetches.calls(FIRECRAWL)).toBe(2);
  });

  test("a spent budget keeps what a cheaper tier found", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    // The shop page has a title but no image, so the chain would ask Firecrawl for one.
    const fetches = stubFetch(
      () =>
        new Response(
          "<html><head><title>Mountain Vista 1000</title></head><body></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    );
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");
    await seedBucket(t, "firecrawl:global:day", 100);

    const result = await extract(t.withIdentity({ subject: "clerk_alice" }), 0);

    expect(result).toMatchObject({
      ok: true,
      draft: { title: "Mountain Vista 1000" },
    });
    expect(fetches.calls(FIRECRAWL)).toBe(0);
  });
});
