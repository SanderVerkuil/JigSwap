import type { QuickStartStepId } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Quick start state (spec 2026-10-17 §2.1, §2.3, §2.4, §3.1): step "done" is derived from real
// rows; only skipped steps and the welcome/card dismissals are stored, in the caller's own row.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const DAY = 24 * 60 * 60 * 1000;

const insertUser = (
  t: T,
  name: string,
  over: { createdAt?: number; location?: string } = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: over.createdAt ?? now,
      updatedAt: now,
      ...(over.location !== undefined ? { location: over.location } : {}),
    });
  });

const as = (t: T, name: string) => t.withIdentity({ subject: `clerk_${name}` });

// `n` catalog puzzles with one copy each, owned by `ownerId`; returns the copy ids.
const insertCopies = (t: T, ownerId: Id<"users">, n: number) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"ownedPuzzles">[] = [];
    for (let i = 0; i < n; i++) {
      const aggregateId = crypto.randomUUID();
      const puzzleId = await ctx.db.insert("puzzles", {
        aggregateId,
        title: `Puzzle ${i}`,
        brand: "Ravensburger",
        pieceCount: 1000,
        searchableText: `Puzzle ${i}`,
        status: "approved",
        submittedBy: ownerId,
        createdAt: now,
        updatedAt: now,
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
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return ids;
  });

const insertCompletion = (
  t: T,
  userId: Id<"users">,
  copyId: Id<"ownedPuzzles">,
  over: { isCompleted?: boolean; datePrecision?: "year" | "unknown" } = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId,
      ownedPuzzleId: copyId,
      startDate: now,
      photos: [],
      isCompleted: over.isCompleted ?? true,
      ...(over.datePrecision ? { datePrecision: over.datePrecision } : {}),
      createdAt: now,
      updatedAt: now,
    });
  });

const insertFollow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: Date.now(),
    });
  });

const insertFollowRequest = (
  t: T,
  requesterId: Id<"users">,
  targetId: Id<"users">,
  status: "pending" | "approved" | "declined",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("followRequests", {
      aggregateId: crypto.randomUUID(),
      requesterId,
      targetId,
      status,
      createdAt: Date.now(),
    });
  });

const insertHouseholdMember = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("householdMembers", {
      householdId: "hh-1",
      memberId,
      role: "admin",
      joinedAt: Date.now(),
    });
  });

const insertHouseholdInvite = (
  t: T,
  inviterId: Id<"users">,
  inviteeId: Id<"users">,
  status: "pending" | "declined",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("householdInvites", {
      aggregateId: crypto.randomUUID(),
      householdId: "hh-1",
      inviterId,
      inviteeId,
      status,
      createdAt: Date.now(),
    });
  });

const insertProfile = (
  t: T,
  memberId: Id<"users">,
  visibility?: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      ...(visibility ? { visibility } : {}),
      updatedAt: Date.now(),
    });
  });

const quickStart = (t: T, who: string) =>
  as(t, who).query(api.onboarding.getQuickStart.getQuickStart, {});

const stepOf = async (t: T, who: string, id: QuickStartStepId) =>
  (await quickStart(t, who)).steps.find((s) => s.id === id);

type Command =
  | { kind: "skipStep" | "unskipStep"; step: QuickStartStepId }
  | {
      kind:
        "dismissWelcome" | "dismissCard" | "restoreCard" | "startQuickStart";
    };

const record = (t: T, who: string, command: Command) =>
  as(t, who).mutation(
    api.onboarding.recordQuickStart.recordQuickStart,
    command,
  );

const rowsOf = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("memberOnboarding")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect(),
  );

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

describe("onboarding: authentication", () => {
  test("both functions reject an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    await expect(
      t.query(api.onboarding.getQuickStart.getQuickStart, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.onboarding.recordQuickStart.recordQuickStart, {
        kind: "dismissWelcome",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("an identity with no member row is rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(quickStart(t, "ghost")).rejects.toThrow(/Member not found/);
    await expect(record(t, "ghost", { kind: "dismissCard" })).rejects.toThrow(
      /Member not found/,
    );
  });
});

describe("onboarding.getQuickStart: a fresh member", () => {
  test("is eligible, sees the welcome and the card, every step todo, no row written", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    expect(await quickStart(t, "ann")).toEqual({
      eligible: true,
      showWelcome: true,
      cardVisible: true,
      steps: [
        { id: "puzzles", status: "todo", optional: false, count: 0 },
        { id: "solves", status: "todo", optional: false, count: 0 },
        { id: "people", status: "todo", optional: false, count: 0 },
        {
          id: "household",
          status: "todo",
          optional: true,
          pendingInvite: false,
        },
        { id: "profile", status: "todo", optional: false },
      ],
      requiredDone: 0,
      requiredTotal: 4,
    });
    expect(await rowsOf(t, ann)).toEqual([]);
  });
});

describe("onboarding.getQuickStart: derived steps", () => {
  test("puzzles: 2 copies is todo, 3 is done; others' copies don't count", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await insertCopies(t, bob, 5);
    await insertCopies(t, ann, 2);
    expect(await stepOf(t, "ann", "puzzles")).toMatchObject({
      status: "todo",
      count: 2,
    });
    await insertCopies(t, ann, 1);
    expect(await stepOf(t, "ann", "puzzles")).toMatchObject({
      status: "done",
      count: 3,
    });
  });

  test("the copy count is capped at 51", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await insertCopies(t, ann, 53);
    expect((await stepOf(t, "ann", "puzzles"))?.count).toBe(51);
  });

  test("solves: an in-progress solve or another member's solve doesn't count", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    const [copy] = await insertCopies(t, ann, 1);
    await insertCompletion(t, ann, copy, { isCompleted: false });
    await insertCompletion(t, bob, copy);
    expect(await stepOf(t, "ann", "solves")).toMatchObject({
      status: "todo",
      count: 0,
    });
  });

  test.each(["year", "unknown"] as const)(
    "solves: a %s-precision solve counts",
    async (datePrecision) => {
      const t = convexTest(schema, modules);
      const ann = await insertUser(t, "ann");
      const [copy] = await insertCopies(t, ann, 1);
      await insertCompletion(t, ann, copy, { datePrecision });
      expect(await stepOf(t, "ann", "solves")).toMatchObject({
        status: "done",
        count: 1,
      });
    },
  );

  test("solves: a day-precision solve counts", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const [copy] = await insertCopies(t, ann, 1);
    await insertCompletion(t, ann, copy);
    await insertCompletion(t, ann, copy);
    expect(await stepOf(t, "ann", "solves")).toMatchObject({
      status: "done",
      count: 2,
    });
  });

  test("people: being followed is not enough; a one-way follow by me is", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await insertFollow(t, bob, ann);
    expect(await stepOf(t, "ann", "people")).toMatchObject({
      status: "todo",
      count: 0,
    });
    await insertFollow(t, ann, bob);
    expect(await stepOf(t, "ann", "people")).toMatchObject({
      status: "done",
      count: 1,
    });
  });

  test("people: a pending follow request counts, a declined one doesn't", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    const carol = await insertUser(t, "carol");
    await insertFollowRequest(t, ann, bob, "declined");
    await insertFollowRequest(t, bob, ann, "pending");
    expect((await stepOf(t, "ann", "people"))?.status).toBe("todo");
    await insertFollowRequest(t, ann, carol, "pending");
    expect(await stepOf(t, "ann", "people")).toMatchObject({
      status: "done",
      count: 0,
    });
  });

  test("household: a pending invite is flagged, membership is done", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await insertHouseholdInvite(t, bob, ann, "declined");
    expect(await stepOf(t, "ann", "household")).toMatchObject({
      status: "todo",
      pendingInvite: false,
    });
    await insertHouseholdInvite(t, bob, ann, "pending");
    expect(await stepOf(t, "ann", "household")).toMatchObject({
      status: "todo",
      pendingInvite: true,
    });
    await insertHouseholdMember(t, ann);
    expect((await stepOf(t, "ann", "household"))?.status).toBe("done");
  });

  test("household: another member's household doesn't count", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await insertHouseholdMember(t, bob);
    expect((await stepOf(t, "ann", "household"))?.status).toBe("todo");
  });

  test("profile: a location is done; a blank one isn't", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann", { location: "  " });
    await insertUser(t, "bob", { location: "Utrecht" });
    expect((await stepOf(t, "ann", "profile"))?.status).toBe("todo");
    expect((await stepOf(t, "bob", "profile"))?.status).toBe("done");
  });

  test("profile: an explicit visibility is done; a profile without one isn't", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await insertProfile(t, ann);
    await insertProfile(t, bob, "public");
    expect((await stepOf(t, "ann", "profile"))?.status).toBe("todo");
    expect((await stepOf(t, "bob", "profile"))?.status).toBe("done");
  });

  test("a skipped step that becomes done shows as done", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await record(t, "ann", { kind: "skipStep", step: "puzzles" });
    expect((await stepOf(t, "ann", "puzzles"))?.status).toBe("skipped");
    await insertCopies(t, ann, 3);
    expect((await stepOf(t, "ann", "puzzles"))?.status).toBe("done");
  });
});

describe("onboarding.getQuickStart: eligibility", () => {
  test("an old member with 0 copies gets the card but not the welcome", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann", { createdAt: Date.now() - 365 * DAY });
    expect(await quickStart(t, "ann")).toMatchObject({
      eligible: false,
      showWelcome: false,
      cardVisible: true,
    });
  });

  test("an old member with copies gets neither", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", {
      createdAt: Date.now() - 365 * DAY,
    });
    await insertCopies(t, ann, 1);
    expect(await quickStart(t, "ann")).toMatchObject({
      eligible: false,
      showWelcome: false,
      cardVisible: false,
    });
  });

  test("a 10-day-old member with copies gets the card but not the welcome", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", {
      createdAt: Date.now() - 10 * DAY,
    });
    await insertCopies(t, ann, 1);
    expect(await quickStart(t, "ann")).toMatchObject({
      eligible: false,
      showWelcome: false,
      cardVisible: true,
    });
  });
});

describe("onboarding.recordQuickStart", () => {
  test("skip and unskip persist in the caller's row and are idempotent", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    expect(
      await record(t, "ann", { kind: "skipStep", step: "profile" }),
    ).toBeNull();
    await record(t, "ann", { kind: "skipStep", step: "solves" });
    const [first] = await rowsOf(t, ann);
    expect(first.skippedSteps).toEqual(["solves", "profile"]);

    await record(t, "ann", { kind: "skipStep", step: "solves" });
    const rows = await rowsOf(t, ann);
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedAt).toBe(first.updatedAt);
    expect((await stepOf(t, "ann", "solves"))?.status).toBe("skipped");

    await record(t, "ann", { kind: "unskipStep", step: "solves" });
    expect((await rowsOf(t, ann))[0].skippedSteps).toEqual(["profile"]);
    expect((await stepOf(t, "ann", "solves"))?.status).toBe("todo");
  });

  test("startQuickStart stores the first start once and keeps other state", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await record(t, "ann", { kind: "skipStep", step: "solves" });
    await record(t, "ann", { kind: "startQuickStart" });
    const [first] = await rowsOf(t, ann);
    expect(first.startedAt).toEqual(expect.any(Number));
    expect(first.skippedSteps).toEqual(["solves"]);
    await record(t, "ann", { kind: "startQuickStart" });
    const [again] = await rowsOf(t, ann);
    expect(again.startedAt).toBe(first.startedAt);
    expect(again.updatedAt).toBe(first.updatedAt);
    // A later change keeps the start mark.
    await record(t, "ann", { kind: "dismissCard" });
    expect((await rowsOf(t, ann))[0].startedAt).toBe(first.startedAt);
  });

  test("a no-op on a member without a row writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await record(t, "ann", { kind: "unskipStep", step: "people" });
    await record(t, "ann", { kind: "restoreCard" });
    expect(await rowsOf(t, ann)).toEqual([]);
  });

  test("dismissing the welcome hides it and keeps the first timestamp", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await record(t, "ann", { kind: "dismissWelcome" });
    const [row] = await rowsOf(t, ann);
    expect(row.welcomeDismissedAt).toEqual(expect.any(Number));
    expect(await quickStart(t, "ann")).toMatchObject({
      eligible: true,
      showWelcome: false,
      cardVisible: true,
    });
    await record(t, "ann", { kind: "dismissWelcome" });
    expect((await rowsOf(t, ann))[0].welcomeDismissedAt).toBe(
      row.welcomeDismissedAt,
    );
  });

  test("dismissing the card hides it; restoring brings it back", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await record(t, "ann", { kind: "dismissCard" });
    await record(t, "ann", { kind: "dismissCard" });
    expect((await quickStart(t, "ann")).cardVisible).toBe(false);
    expect((await rowsOf(t, ann))[0].cardDismissedAt).toEqual(
      expect.any(Number),
    );
    await record(t, "ann", { kind: "restoreCard" });
    expect((await quickStart(t, "ann")).cardVisible).toBe(true);
    expect((await rowsOf(t, ann))[0].cardDismissedAt).toBeUndefined();
  });

  test("rejects an unknown step id and an unknown kind", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    await expect(
      record(t, "ann", {
        kind: "skipStep",
        step: "bogus" as QuickStartStepId,
      }),
    ).rejects.toThrow(/Validator/);
    await expect(
      record(t, "ann", { kind: "dismissEverything" } as unknown as Command),
    ).rejects.toThrow(/Validator/);
    expect(await rowsOf(t, ann)).toEqual([]);
  });

  test("rejects a step on a dismissal and a skip without a step", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    expect(
      await codeOf(
        record(t, "ann", {
          kind: "dismissCard",
          step: "puzzles",
        } as unknown as Command),
      ),
    ).toBe("invalid_change");
    expect(
      await codeOf(record(t, "ann", { kind: "skipStep" } as Command)),
    ).toBe("invalid_change");
    expect(await rowsOf(t, ann)).toEqual([]);
  });

  test("writes only the caller's row; a client-supplied member id is rejected", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob");
    await record(t, "bob", { kind: "skipStep", step: "people" });
    await record(t, "ann", { kind: "dismissCard" });
    await record(t, "ann", { kind: "skipStep", step: "puzzles" });

    expect(await rowsOf(t, bob)).toMatchObject([
      { memberId: bob, skippedSteps: ["people"] },
    ]);
    expect((await rowsOf(t, bob))[0].cardDismissedAt).toBeUndefined();
    expect(await rowsOf(t, ann)).toMatchObject([
      { memberId: ann, skippedSteps: ["puzzles"] },
    ]);
    expect((await quickStart(t, "bob")).cardVisible).toBe(true);

    await expect(
      record(t, "ann", {
        kind: "dismissWelcome",
        memberId: bob,
      } as unknown as Command),
    ).rejects.toThrow(/Validator/);
    expect((await rowsOf(t, bob))[0].welcomeDismissedAt).toBeUndefined();
  });
});

describe("insights.exportUserData: quick start", () => {
  test("includes the member's own onboarding row, or null", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    await insertUser(t, "bob");
    await record(t, "ann", { kind: "skipStep", step: "household" });
    const ann = await as(t, "ann").query(
      api.insights.exportUserData.exportUserData,
      {},
    );
    expect(ann.quickStart).toMatchObject({ skippedSteps: ["household"] });
    const bob = await as(t, "bob").query(
      api.insights.exportUserData.exportUserData,
      {},
    );
    expect(bob.quickStart).toBeNull();
  });
});
