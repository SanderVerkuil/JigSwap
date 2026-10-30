import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Daily per-member budgets on the writes that feed Browse and the activity feed (SEC-29, SEC-30):
// copies added (counted per copy) and solves logged (counted per solve).
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 25;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const definitions: string[] = [];
    for (let i = 0; i < BATCH; i++) {
      const aggregateId = crypto.randomUUID();
      await ctx.db.insert("puzzles", {
        aggregateId,
        title: `Puzzle ${i}`,
        pieceCount: 1000,
        searchableText: `Puzzle ${i}`,
        status: "approved",
        submittedBy: bob,
        createdAt: now,
        updatedAt: now,
      });
      definitions.push(aggregateId);
    }
    return { alice, bob, definitions };
  });

const as = (t: T, name: string) => t.withIdentity({ subject: `clerk_${name}` });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string; retryAfterMs?: number } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string" ? JSON.parse(data) : (data as never);
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

const limitRow = (t: T, name: keyof typeof RATE_LIMITS, memberId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `${name}:${memberId}`))
      .unique(),
  );

// Pretend the member already used `count` of the limit, in a window that started `ageMs` ago.
const setUsed = (
  t: T,
  name: keyof typeof RATE_LIMITS,
  memberId: string,
  count: number,
  ageMs = 0,
) =>
  t.run(async (ctx) => {
    const key = `${name}:${memberId}`;
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const windowStart = Date.now() - ageMs;
    if (row) await ctx.db.patch(row._id, { windowStart, count });
    else await ctx.db.insert("rateLimits", { key, windowStart, count });
  });

const copiesOf = (t: T, ownerId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect(),
  );

const eventCount = (t: T, name: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("domainEvents")
          .withIndex("by_name", (q) => q.eq("name", name))
          .collect()
      ).length,
  );

const acquireCopies = (t: T, who: string, definitions: string[]) =>
  as(t, who).mutation(api.library.acquireCopies.acquireCopies, {
    items: definitions.map((puzzleDefinitionId) => ({ puzzleDefinitionId })),
  });

const acquireCopy = (t: T, who: string, puzzleDefinitionId: string) =>
  as(t, who).mutation(api.library.acquireCopy.acquireCopy, {
    puzzleDefinitionId,
    condition: "good",
  });

describe("enforceRateLimit amount", () => {
  test("charges the amount, and refuses without writing when it would go over", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const { max } = RATE_LIMITS.copyAdd;

    await t.run((ctx) =>
      enforceRateLimit(ctx, "copyAdd", alice, undefined, max - 3),
    );
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(max - 3);

    await expectConvexCode(
      t.run((ctx) => enforceRateLimit(ctx, "copyAdd", alice, undefined, 4)),
      "RateLimited",
    );
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(max - 3);

    await t.run((ctx) => enforceRateLimit(ctx, "copyAdd", alice, undefined, 3));
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(max);
  });

  test("defaults to one action", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run((ctx) => enforceRateLimit(ctx, "copyAdd", alice));
    await t.run((ctx) => enforceRateLimit(ctx, "copyAdd", alice));
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(2);
  });
});

describe("daily copy cap (SEC-29)", () => {
  test("a batch add counts every copy, and 20 full batches use up the day", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const batches = RATE_LIMITS.copyAdd.max / BATCH;

    await acquireCopies(t, "alice", definitions);
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(BATCH);

    for (let i = 1; i < batches; i++) {
      await acquireCopies(t, "alice", definitions);
    }
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(
      RATE_LIMITS.copyAdd.max,
    );
    expect(await copiesOf(t, alice)).toHaveLength(RATE_LIMITS.copyAdd.max);

    await expectConvexCode(
      acquireCopies(t, "alice", definitions.slice(0, 1)),
      "RateLimited",
    );
    expect(await copiesOf(t, alice)).toHaveLength(RATE_LIMITS.copyAdd.max);
    expect(await eventCount(t, "CopyAcquired")).toBe(RATE_LIMITS.copyAdd.max);
  }, 60_000);

  test("a batch that would cross the cap is refused whole and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const used = RATE_LIMITS.copyAdd.max - BATCH + 1;
    await setUsed(t, "copyAdd", alice, used);

    await expectConvexCode(
      acquireCopies(t, "alice", definitions),
      "RateLimited",
    );
    expect(await copiesOf(t, alice)).toHaveLength(0);
    expect(await eventCount(t, "CopyAcquired")).toBe(0);
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(used);

    // The batch that exactly fills the day still goes through.
    await acquireCopies(t, "alice", definitions.slice(0, BATCH - 1));
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(
      RATE_LIMITS.copyAdd.max,
    );
  });

  test("a single add counts one copy and is refused once the day is used up", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);

    await acquireCopy(t, "alice", definitions[0]!);
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(1);

    await setUsed(t, "copyAdd", alice, RATE_LIMITS.copyAdd.max);
    await expectConvexCode(
      acquireCopy(t, "alice", definitions[1]!),
      "RateLimited",
    );
    expect(await copiesOf(t, alice)).toHaveLength(1);
  });

  test("the budget comes back after a day", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    await setUsed(t, "copyAdd", alice, RATE_LIMITS.copyAdd.max, DAY);

    await acquireCopies(t, "alice", definitions);
    expect((await limitRow(t, "copyAdd", alice))?.count).toBe(BATCH);
  });

  test("one member's budget doesn't limit another", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, definitions } = await seed(t);
    await setUsed(t, "copyAdd", alice, RATE_LIMITS.copyAdd.max);

    await acquireCopy(t, "bob", definitions[0]!);
    expect(await copiesOf(t, bob)).toHaveLength(1);
  });
});
