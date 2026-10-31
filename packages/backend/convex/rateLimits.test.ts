import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  chargeBudget,
  enforceRateLimit,
  RATE_LIMITS,
  type BudgetWindow,
} from "./lib/rateLimits";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice"),
      bob: await mkUser("clerk_bob"),
    };
  });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string; retryAfterMs?: number } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string" ? JSON.parse(data) : (data as never);
};

// Use up `n` actions of the member's limit in one transaction.
const consume = (
  t: TestConvex<typeof schema>,
  memberId: Id<"users">,
  n: number,
  name: keyof typeof RATE_LIMITS = "reportFile",
) =>
  t.run(async (ctx) => {
    for (let i = 0; i < n; i++) await enforceRateLimit(ctx, name, memberId);
  });

const attempt = (
  t: TestConvex<typeof schema>,
  memberId: Id<"users">,
  name: keyof typeof RATE_LIMITS = "reportFile",
) => t.run((ctx) => enforceRateLimit(ctx, name, memberId));

describe("enforceRateLimit", () => {
  test("passes while under the limit", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await consume(t, alice, RATE_LIMITS.reportFile.max);
    const row = await t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `reportFile:${alice}`))
        .unique(),
    );
    expect(row?.count).toBe(RATE_LIMITS.reportFile.max);
  });

  test("throws RateLimited with retryAfterMs once the window is full", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await consume(t, alice, RATE_LIMITS.reportFile.max);

    const error = await attempt(t, alice).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    const data = dataOf(error);
    expect(data.code).toBe("RateLimited");
    expect(data.retryAfterMs).toBeGreaterThan(0);
    expect(data.retryAfterMs).toBeLessThanOrEqual(
      RATE_LIMITS.reportFile.windowMs,
    );
  });

  test("a new window resets the count in place", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await consume(t, alice, RATE_LIMITS.reportFile.max);
    // Age the window past its length.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `reportFile:${alice}`))
        .unique();
      await ctx.db.patch(row!._id, {
        windowStart: Date.now() - RATE_LIMITS.reportFile.windowMs,
      });
    });

    await attempt(t, alice);
    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(1);
  });

  test("keys are isolated per member and per limit", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await consume(t, alice, RATE_LIMITS.reportFile.max);

    await expect(attempt(t, bob)).resolves.toBeNull();
    await expect(attempt(t, alice, "blockToggle")).resolves.toBeNull();
    await expect(attempt(t, alice)).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("postMessage rate limit", () => {
  test("refuses the post past messagePost's limit", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: alice,
        followeeId: bob,
        createdAt: 1,
      });
      await ctx.db.insert("follows", {
        followerId: bob,
        followeeId: alice,
        createdAt: 2,
      });
    });
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const threadId = await asAlice.mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await consume(t, alice, RATE_LIMITS.messagePost.max, "messagePost");

    const error = await asAlice
      .mutation(api.conversation.postMessage.postMessage, {
        threadId,
        kind: "text",
        body: "one too many",
      })
      .catch((e: unknown) => e);
    expect(dataOf(error).code).toBe("RateLimited");
  });
});

describe("chargeBudget", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const windows: BudgetWindow[] = [
    { key: "test:global:hour", windowMs: HOUR, cap: 5 },
    { key: "test:global:day", windowMs: DAY, cap: 3 },
  ];

  const counts = (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("rateLimits").collect()).map((row) => [
          row.key,
          row.count,
        ]),
      ),
    );

  test("charges every window and answers null", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => chargeBudget(ctx, windows))).resolves.toBe(
      null,
    );
    await expect(t.run((ctx) => chargeBudget(ctx, windows, 2))).resolves.toBe(
      null,
    );
    expect(await counts(t)).toEqual({
      "test:global:hour": 3,
      "test:global:day": 3,
    });
  });

  test("refuses with nothing written when any window would go over", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) await chargeBudget(ctx, windows);
    });

    // The hour still has room, the day is full: neither row moves.
    const retryAfterMs = await t.run((ctx) => chargeBudget(ctx, windows));
    expect(retryAfterMs).toBeGreaterThan(HOUR);
    expect(retryAfterMs).toBeLessThanOrEqual(DAY);
    expect(await counts(t)).toEqual({
      "test:global:hour": 3,
      "test:global:day": 3,
    });
  });

  test("a refusal writes no row for a window it has not used yet", async () => {
    const t = convexTest(schema, modules);
    const tight: BudgetWindow[] = [
      { key: "test:a", windowMs: HOUR, cap: 1 },
      { key: "test:b", windowMs: HOUR, cap: 10 },
    ];
    await t.run((ctx) => chargeBudget(ctx, tight.slice(0, 1)));
    await expect(t.run((ctx) => chargeBudget(ctx, tight))).resolves.toEqual(
      expect.any(Number),
    );
    expect(await counts(t)).toEqual({ "test:a": 1 });
  });

  test("a window that has passed starts again from this charge", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) await chargeBudget(ctx, windows);
    });
    // Age both windows past their length.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("rateLimits").collect()) {
        await ctx.db.patch(row._id, { windowStart: Date.now() - DAY });
      }
    });

    await expect(t.run((ctx) => chargeBudget(ctx, windows))).resolves.toBe(
      null,
    );
    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.count).toBe(1);
      expect(Date.now() - row.windowStart).toBeLessThan(HOUR);
    }
  });
});

describe("chargeBudget logging", () => {
  const HOUR = 3_600_000;
  const windows: BudgetWindow[] = [
    { key: "test:global:hour", windowMs: HOUR, cap: 2 },
  ];

  // Wide events are JSON lines: info on console.log, error on console.error.
  const eventsOf = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );
  const spyLogs = () => ({
    info: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("logs every refusal at error level by default", async () => {
    const t = convexTest(schema, modules);
    const logs = spyLogs();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) await chargeBudget(ctx, windows);
    });

    expect(
      eventsOf(logs.error).filter((e) => e.event === "rateLimit.refused"),
    ).toHaveLength(3);
  });

  test("with logRefusals: false a refusal logs nothing", async () => {
    const t = convexTest(schema, modules);
    const logs = spyLogs();
    const results = await t.run(async (ctx) => {
      const out = [];
      for (let i = 0; i < 50; i++) {
        out.push(await chargeBudget(ctx, windows, 1, { logRefusals: false }));
      }
      return out;
    });

    expect(results.filter((r) => r !== null)).toHaveLength(48);
    expect(logs.error).not.toHaveBeenCalled();
  });

  test("logs once, at info level, when a charge fills a window", async () => {
    const t = convexTest(schema, modules);
    const logs = spyLogs();
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        await chargeBudget(ctx, windows, 1, { logRefusals: false });
      }
    });

    expect(
      eventsOf(logs.info).filter((e) => e.event === "rateLimit.filled"),
    ).toEqual([
      expect.objectContaining({
        outcome: "success",
        limit: "test:global:hour",
        max: 2,
        window_ms: HOUR,
      }),
    ]);
  });
});
