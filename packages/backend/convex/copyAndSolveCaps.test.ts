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

describe("a logged solve names a copy or a puzzle (SEC-30)", () => {
  const completionCount = (t: T) =>
    t.run(async (ctx) => (await ctx.db.query("completions").collect()).length);

  test("a copy-less, puzzle-less solve is refused and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    // The flood vector: a far-future in-progress solve against nothing, hidden from every feed.
    await expectConvexCode(
      as(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
        startDate: Date.now() + 10 * 365 * DAY,
      }),
      "CompletionTargetRequired",
    );
    await expectConvexCode(
      as(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
        datePrecision: "unknown",
      }),
      "CompletionTargetRequired",
    );
    expect(await completionCount(t)).toBe(0);
    expect(await eventCount(t, "CompletionStarted")).toBe(0);
    expect(await eventCount(t, "CompletionRecorded")).toBe(0);
  });

  test("a solve that names only a puzzle is still accepted", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);
    await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        puzzleDefinitionId: definitions[0]!,
        datePrecision: "unknown",
      },
    );
    expect(await completionCount(t)).toBe(1);
  });
});

describe("daily solve cap (SEC-30)", () => {
  const completionsOf = (t: T, userId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );

  const recordSolve = (t: T, who: string, puzzleDefinitionId: string) =>
    as(t, who).mutation(api.solving.recordCompletion.recordCompletion, {
      puzzleDefinitionId,
      datePrecision: "unknown",
    });

  const startSolve = (t: T, who: string, copyId: string) =>
    as(t, who).mutation(api.solving.startCompletion.startCompletion, {
      copyId,
      startDate: Date.now(),
    });

  const recordPast = (t: T, who: string, copyIds: string[]) =>
    as(t, who).mutation(
      api.solving.recordPastCompletions.recordPastCompletions,
      {
        items: copyIds.map((copyId) => ({
          copyId,
          datePrecision: "unknown" as const,
        })),
      },
    );

  test("recordCompletion and startCompletion count one solve each", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const {
      copyIds: [copyId],
    } = await acquireCopies(t, "alice", definitions.slice(0, 1));

    await recordSolve(t, "alice", definitions[0]!);
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(1);
    await startSolve(t, "alice", copyId!);
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(2);
  });

  test("recordPastCompletions counts every solve in the batch", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const { copyIds } = await acquireCopies(t, "alice", definitions);

    await recordPast(t, "alice", copyIds);
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(BATCH);
  });

  test("a batch that would cross the cap is refused whole and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const { copyIds } = await acquireCopies(
      t,
      "alice",
      definitions.slice(0, 3),
    );
    const used = RATE_LIMITS.solveLog.max - 2;
    await setUsed(t, "solveLog", alice, used);

    await expectConvexCode(recordPast(t, "alice", copyIds), "RateLimited");
    expect(await completionsOf(t, alice)).toHaveLength(0);
    expect(await eventCount(t, "CompletionRecorded")).toBe(0);
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(used);

    await recordPast(t, "alice", copyIds.slice(0, 2));
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(
      RATE_LIMITS.solveLog.max,
    );
  });

  test("every solve path is refused once the day is used up", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitions } = await seed(t);
    const { copyIds } = await acquireCopies(
      t,
      "alice",
      definitions.slice(0, 1),
    );
    await setUsed(t, "solveLog", alice, RATE_LIMITS.solveLog.max);

    await expectConvexCode(
      recordSolve(t, "alice", definitions[0]!),
      "RateLimited",
    );
    await expectConvexCode(startSolve(t, "alice", copyIds[0]!), "RateLimited");
    await expectConvexCode(recordPast(t, "alice", copyIds), "RateLimited");
    expect(await completionsOf(t, alice)).toHaveLength(0);
    expect(await eventCount(t, "CompletionStarted")).toBe(0);
    expect(await eventCount(t, "CompletionRecorded")).toBe(0);
  });

  test("the budget comes back after a day, and is per member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, definitions } = await seed(t);
    await setUsed(t, "solveLog", alice, RATE_LIMITS.solveLog.max);

    await recordSolve(t, "bob", definitions[0]!);
    expect(await completionsOf(t, bob)).toHaveLength(1);

    await setUsed(t, "solveLog", alice, RATE_LIMITS.solveLog.max, DAY);
    await recordSolve(t, "alice", definitions[0]!);
    expect((await limitRow(t, "solveLog", alice))?.count).toBe(1);
  });
});
