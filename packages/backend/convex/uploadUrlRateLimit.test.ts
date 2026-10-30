import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// SEC-20: the shared upload URL (copy photos, completion photos, box art) is rate limited per
// member, hourly and daily, like its message-photo and circle-icon siblings, and every mint is
// logged with the member, so junk uploads can be attributed.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const HOUR = 60 * 60 * 1000;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
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
const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  const parsed: { code?: string } =
    typeof data === "string" ? JSON.parse(data) : (data as never);
  return parsed.code;
};

const mint = (t: T, clerkId = "clerk_alice") =>
  t
    .withIdentity({ subject: clerkId })
    .mutation(api.puzzles.generateUploadUrl, {});

const mintMany = async (t: T, n: number) => {
  for (let i = 0; i < n; i++) await mint(t);
};

// Age the member's window for `name` so the next call opens a new one.
const ageWindow = (
  t: T,
  name: "uploadUrl" | "uploadUrlDaily",
  memberId: Id<"users">,
) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `${name}:${memberId}`))
      .unique();
    await ctx.db.patch(row!._id, {
      windowStart: row!.windowStart - RATE_LIMITS[name].windowMs,
    });
  });

describe("puzzles.generateUploadUrl", () => {
  test("anonymous callers get no URL", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.puzzles.generateUploadUrl, {})).rejects.toThrow(
      /Unauthenticated/,
    );
  });

  test("the 61st URL in an hour is refused as RateLimited, other members unaffected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await mintMany(t, RATE_LIMITS.uploadUrl.max);

    const error = await mint(t).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect(codeOf(error)).toBe("RateLimited");

    await expect(mint(t, "clerk_bob")).resolves.toEqual(expect.any(String));
  });

  test("a new hour resets the hourly limit", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await mintMany(t, RATE_LIMITS.uploadUrl.max);
    await expect(mint(t)).rejects.toThrow(/RateLimited/);

    await ageWindow(t, "uploadUrl", alice);
    await expect(mint(t)).resolves.toEqual(expect.any(String));
  });

  test("the daily cap holds even when every hour is under the hourly limit", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const hours = RATE_LIMITS.uploadUrlDaily.max / RATE_LIMITS.uploadUrl.max;
    for (let h = 0; h < hours; h++) {
      await mintMany(t, RATE_LIMITS.uploadUrl.max);
      await ageWindow(t, "uploadUrl", alice);
    }

    const error = await mint(t).catch((e: unknown) => e);
    expect(codeOf(error)).toBe("RateLimited");

    // A new day opens the daily window again.
    await ageWindow(t, "uploadUrlDaily", alice);
    await expect(mint(t)).resolves.toEqual(expect.any(String));
  });

  test("each mint logs a storage.uploadUrl event with the member", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await mint(t);

    const events = logs
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((e) => e.event === "storage.uploadUrl");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "success",
      member_id: alice,
    });
  });

  test("the hourly limit sits under the daily cap, which bounds one member's URLs to 300 a day", () => {
    expect(RATE_LIMITS.uploadUrl).toEqual({ windowMs: HOUR, max: 60 });
    expect(RATE_LIMITS.uploadUrlDaily).toEqual({
      windowMs: 24 * HOUR,
      max: 300,
    });
  });
});
