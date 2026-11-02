import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { SOLVE_STATE_READ_CAP } from "./solving/listMySolveStates";

// solving.mySolveStates: for each copy the member has a solve on, whether it is finished or in
// progress (PERF-B13). What the library's pills and "already solved" marks read, instead of the
// whole joined history, so they stay right past the history's 1000-row cap.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  copyA: Id<"ownedPuzzles">;
  copyB: Id<"ownedPuzzles">;
}

const seed = (t: T): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await user("ann");
    const bob = await user("bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    const copy = () =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: ann,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    return { ann, bob, copyA: await copy(), copyB: await copy() };
  });

const addCompletion = (
  t: T,
  userId: Id<"users">,
  extra: Partial<Doc<"completions">>,
) =>
  t.run((ctx) =>
    ctx.db.insert("completions", {
      userId,
      startDate: 1,
      photos: [],
      isCompleted: true,
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    }),
  );

const statesOf = (t: T, who: string) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.solving.listMySolveStates.listMySolveStates, {});

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("solving.mySolveStates", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.solving.listMySolveStates.listMySolveStates, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("one row per copy, finished and in progress, only the caller's", async () => {
    await addCompletion(t, w.ann, { ownedPuzzleId: w.copyA, endDate: 2 });
    await addCompletion(t, w.ann, { ownedPuzzleId: w.copyA, endDate: 3 });
    await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyB,
      isCompleted: false,
      aggregateId: "solve-1",
      startDate: 5,
    });
    await addCompletion(t, w.bob, { ownedPuzzleId: w.copyB, endDate: 2 });
    // A solve with no copy (the copy is gone) marks nothing.
    await addCompletion(t, w.ann, { endDate: 2 });

    const states = await statesOf(t, "ann");
    expect(states).toHaveLength(2);
    expect(states.find((s) => s.copyId === w.copyA)).toEqual({
      copyId: w.copyA,
      completed: true,
      inProgress: false,
    });
    expect(states.find((s) => s.copyId === w.copyB)).toEqual({
      copyId: w.copyB,
      completed: false,
      inProgress: true,
      inProgressCompletionId: "solve-1",
      inProgressStartDate: 5,
    });
  });

  test("with two solves in progress the newest-started one is the one to finish", async () => {
    await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyA,
      isCompleted: false,
      aggregateId: "older",
      startDate: 5,
    });
    await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyA,
      isCompleted: false,
      aggregateId: "newer",
      startDate: 9,
    });
    await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyA,
      isCompleted: false,
      startDate: 20,
    });
    const [state] = await statesOf(t, "ann");
    expect(state.inProgressCompletionId).toBe("newer");
    expect(state.inProgressStartDate).toBe(9);
  });

  test("a solve past the history's old 1000-row cap still marks its copy", async () => {
    await addCompletion(t, w.ann, { ownedPuzzleId: w.copyA, endDate: 2 });
    await t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert("completions", {
          userId: w.ann,
          ownedPuzzleId: w.copyB,
          startDate: 1,
          photos: [],
          isCompleted: true,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const states = await statesOf(t, "ann");
    expect(states.map((s) => s.copyId)).toContain(w.copyA);
  });

  test("a solve in progress counts however many finished ones came after it", async () => {
    await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyA,
      isCompleted: false,
      aggregateId: "old-open",
      startDate: 1,
    });
    await t.run(async (ctx) => {
      for (let i = 0; i <= SOLVE_STATE_READ_CAP; i++) {
        await ctx.db.insert("completions", {
          userId: w.ann,
          ownedPuzzleId: w.copyB,
          startDate: 1,
          photos: [],
          isCompleted: true,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const states = await statesOf(t, "ann");
    expect(states.find((s) => s.copyId === w.copyA)?.inProgress).toBe(true);
    expect(states.find((s) => s.copyId === w.copyB)?.completed).toBe(true);
  });
});
