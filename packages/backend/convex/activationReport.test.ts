import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { activationReport } from "./onboarding/activationReport";
import schema from "./schema";

// Activation report (spec 2026-10-17 §1.2, decision 5, decision 10): an internal query over a
// sign-up range that gathers each member's facts from real rows and returns aggregates only.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const DAY = 24 * 60 * 60 * 1000;

// Users are inserted "now" (their _creationTime), so the report range is around now; each member's
// window is anchored on `createdAt`, which every test sets to the same T0.
const T0 = Date.now();
const RANGE = { from: T0 - DAY, to: T0 + DAY };

const insertUser = (t: T, name: string, createdAt = T0) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    }),
  );

// One copy per timestamp, owned by `ownerId`, inserted in the given (chronological) order.
const insertCopies = (t: T, ownerId: Id<"users">, createdAts: number[]) =>
  t.run(async (ctx) => {
    const ids: Id<"ownedPuzzles">[] = [];
    for (const [i, createdAt] of createdAts.entries()) {
      const aggregateId = crypto.randomUUID();
      const puzzleId = await ctx.db.insert("puzzles", {
        aggregateId,
        title: `Puzzle ${i}`,
        brand: "Ravensburger",
        pieceCount: 1000,
        searchableText: `Puzzle ${i}`,
        status: "approved",
        submittedBy: ownerId,
        createdAt,
        updatedAt: createdAt,
      });
      ids.push(
        await ctx.db.insert("ownedPuzzles", {
          aggregateId: crypto.randomUUID(),
          puzzleDefinitionId: aggregateId,
          puzzleId,
          ownerId,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          visibility: "private",
          snapshot: { title: `Puzzle ${i}`, pieceCount: 1000 },
          createdAt,
          updatedAt: createdAt,
        }),
      );
    }
    return ids;
  });

const threeCopies = (t: T, ownerId: Id<"users">) =>
  insertCopies(t, ownerId, [T0, T0 + DAY, T0 + 2 * DAY]);

const insertCompletion = (
  t: T,
  userId: Id<"users">,
  copyId: Id<"ownedPuzzles">,
  createdAt: number,
  over: { isCompleted?: boolean; datePrecision?: "year" | "unknown" } = {},
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId,
      ownedPuzzleId: copyId,
      startDate: createdAt,
      photos: [],
      isCompleted: over.isCompleted ?? true,
      ...(over.datePrecision ? { datePrecision: over.datePrecision } : {}),
      createdAt,
      updatedAt: createdAt,
    });
  });

const insertFollow = (
  t: T,
  followerId: Id<"users">,
  followeeId: Id<"users">,
  createdAt: number,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", { followerId, followeeId, createdAt });
  });

const joinHousehold = (
  t: T,
  householdId: string,
  memberId: Id<"users">,
  joinedAt: number,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("householdMembers", {
      householdId,
      memberId,
      role: "member",
      joinedAt,
    });
  });

const report = (t: T, range: { from: number; to: number } = RANGE) =>
  t.query(internal.onboarding.activationReport.activationReport, range);

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = async (
  promise: Promise<unknown>,
): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<Value>).data;
    return (typeof data === "string" ? JSON.parse(data) : data)?.code;
  }
  throw new Error("expected the call to reject");
};

describe("activationReport: access and shape", () => {
  test("is an internal query, never client-callable", () => {
    expect(activationReport.isInternal).toBe(true);
    expect(activationReport.isQuery).toBe(true);
  });

  test("returns aggregates only, never member ids", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await threeCopies(t, ann);
    const result = await report(t);
    expect(JSON.stringify(result)).not.toContain(ann);
    expect(Object.keys(result).sort()).toEqual([
      "cohorts",
      "from",
      "generatedAt",
      "to",
      "total",
    ]);
    expect(result.total.signedUp).toBe(1);
    expect(result.cohorts).toHaveLength(1);
  });

  test("refuses an empty, reversed or longer-than-31-days range", async () => {
    const t = convexTest(schema, modules);
    expect(await codeOf(report(t, { from: T0, to: T0 }))).toBe("invalid_range");
    expect(await codeOf(report(t, { from: T0, to: T0 - 1 }))).toBe(
      "invalid_range",
    );
    expect(await codeOf(report(t, { from: T0, to: T0 + 31 * DAY + 1 }))).toBe(
      "invalid_range",
    );
  });

  test("only counts members who signed up inside the range", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    const later = await report(t, { from: T0 + DAY, to: T0 + 2 * DAY });
    expect(later.total.signedUp).toBe(0);
    expect((await report(t)).total.signedUp).toBe(1);
  });
});

describe("activationReport: criteria from real rows", () => {
  test("3 copies alone do not activate; 2 copies and a completion do not either", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await threeCopies(t, ann);
    const bob = await insertUser(t, "bob");
    const [copy] = await insertCopies(t, bob, [T0, T0 + DAY]);
    await insertCompletion(t, bob, copy, T0 + DAY);
    const { total } = await report(t);
    expect(total).toMatchObject({ signedUp: 2, activated: 0 });
    expect(total.breakdown).toMatchObject({ copies3: 1, completion: 1 });
  });

  test("a finished solve counts at any date precision; an in-progress one does not", async () => {
    const t = convexTest(schema, modules);
    for (const [name, over] of [
      ["day", {}],
      ["year", { datePrecision: "year" as const }],
      ["unknown", { datePrecision: "unknown" as const }],
      ["inProgress", { isCompleted: false }],
    ] as const) {
      const id = await insertUser(t, name);
      const [copy] = await threeCopies(t, id);
      await insertCompletion(t, id, copy, T0 + DAY, over);
    }
    const { total } = await report(t);
    expect(total).toMatchObject({ signedUp: 4, activated: 3 });
    expect(total.breakdown.completion).toBe(3);
  });

  test("the 7-day boundary: a copy at exactly day 7 counts, one after it does not", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const [copy] = await insertCopies(t, ann, [T0, T0 + DAY, T0 + 7 * DAY]);
    await insertCompletion(t, ann, copy, T0 + 7 * DAY);
    const bob = await insertUser(t, "bob");
    const [late] = await insertCopies(t, bob, [T0, T0 + DAY, T0 + 7 * DAY + 1]);
    await insertCompletion(t, bob, late, T0 + DAY);
    const { total } = await report(t);
    expect(total.activated).toBe(1);
    expect(total.breakdown).toMatchObject({ copies3: 1, completion: 2 });
  });

  test("a mutual connection counts; a one-way follow does not", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    const cat = await insertUser(t, "cat");
    await threeCopies(t, ann);
    await threeCopies(t, cat);
    await insertFollow(t, ann, bob, T0 + DAY);
    await insertFollow(t, bob, ann, T0 + 2 * DAY);
    // cat follows bob, bob never follows back.
    await insertFollow(t, cat, bob, T0 + DAY);
    const { total } = await report(t);
    expect(total.breakdown.mutual).toBe(2); // ann and bob
    expect(total.activated).toBe(1); // only ann also has 3 copies
  });

  test("a follow-back after day 7 does not make the connection count", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await threeCopies(t, ann);
    await insertFollow(t, ann, bob, T0 + DAY);
    await insertFollow(t, bob, ann, T0 + 7 * DAY + 1);
    const { total } = await report(t);
    expect(total.breakdown.mutual).toBe(0);
    expect(total.activated).toBe(0);
  });

  test("a household of one is not a link", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await threeCopies(t, ann);
    await joinHousehold(t, "hh-ann", ann, T0 + DAY);
    const { total } = await report(t);
    expect(total.breakdown.household).toBe(0);
    expect(total.activated).toBe(0);
  });

  test("decision 10: a second member joining after day 7 flips activation to true", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await threeCopies(t, ann);
    await joinHousehold(t, "hh-ann", ann, T0 + DAY);
    expect((await report(t)).total.activated).toBe(0);

    // An existing member (signed up long before the range) joins ann's household on day 20.
    const zed = await insertUser(t, "zed", T0 - 400 * DAY);
    await joinHousehold(t, "hh-ann", zed, T0 + 20 * DAY);
    const { total } = await report(t);
    // zed's row was inserted now, but his sign-up (createdAt) is outside the range.
    expect(total.signedUp).toBe(1);
    expect(total.breakdown.household).toBe(1);
    expect(total.activated).toBe(1);
  });

  test("joining a household after day 7 earns no household link", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob", T0 - 400 * DAY);
    await threeCopies(t, ann);
    await joinHousehold(t, "hh-bob", bob, T0 - 300 * DAY);
    await joinHousehold(t, "hh-bob", ann, T0 + 8 * DAY);
    const { total } = await report(t);
    expect(total.breakdown.household).toBe(0);
    expect(total.activated).toBe(0);
  });
});

describe("activationReport: funnel", () => {
  test("counts welcome answers, quick start starts, skipped steps and household links", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await insertUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("memberOnboarding", {
        memberId: ann,
        skippedSteps: ["solves"],
        welcomeDismissedAt: T0,
        startedAt: T0,
        updatedAt: T0,
      });
      await ctx.db.insert("inviteLinks", {
        ownerId: ann,
        token: "tok",
        createdAt: T0,
        landingViews: 0,
        signupsAttributed: 0,
        followsEstablished: 0,
        context: { kind: "household", householdId: "hh-ann" },
        expiresAt: T0 + 14 * DAY,
      });
    });
    await threeCopies(t, ann);
    const { total } = await report(t);
    expect(total.funnel).toEqual({
      signedUp: 2,
      welcomeAnswered: 1,
      startedQuickStart: 1,
      copies3: 1,
      activated: 0,
      quickStartCompleted: 0,
      householdLinkCreated: 1,
    });
    expect(total.steps.puzzles).toEqual({ done: 1, skipped: 0 });
    expect(total.steps.solves).toEqual({ done: 0, skipped: 1 });
  });

  test("a network invite link is not a household link", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await t.run(async (ctx) => {
      await ctx.db.insert("inviteLinks", {
        ownerId: ann,
        token: "tok",
        createdAt: T0,
        landingViews: 0,
        signupsAttributed: 0,
        followsEstablished: 0,
      });
    });
    expect((await report(t)).total.funnel.householdLinkCreated).toBe(0);
  });
});
