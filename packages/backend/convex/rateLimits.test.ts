import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimits";
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
