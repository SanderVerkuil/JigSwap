import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  COMPLETION_INDEX_CAP,
  COMPLETION_ROWS_MAX,
} from "./solving/completionLogLimits";

// The completion log reads a lean row per solve (for its stats, order and year headings) and joins
// only the rows on screen (PERF-B13).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
  copyId: Id<"ownedPuzzles">;
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
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: ann,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { ann, bob, puzzleId, copyId };
  });

const addCompletion = (
  t: T,
  userId: Id<"users">,
  extra: Partial<Doc<"completions">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("completions", {
      userId,
      startDate: 10,
      endDate: 20,
      photos: [],
      isCompleted: true,
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    }),
  );

const indexOf = (t: T, who: string) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.solving.listMyCompletionIndex.listMyCompletionIndex, {});

const rowsOf = (t: T, who: string, completionIds: Id<"completions">[]) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.solving.getMyCompletionsByIds.getMyCompletionsByIds, {
      completionIds,
    });

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("solving.myCompletionIndex", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.solving.listMyCompletionIndex.listMyCompletionIndex, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("one lean row per own solve, with what the log orders and counts by", async () => {
    const done = await addCompletion(t, w.ann, {
      notes: "private note",
      endDate: 99,
      datePrecision: "year",
      copySnapshot: {
        copyId: "c",
        ownerId: w.ann,
        wasBorrowed: false,
        condition: "good",
        title: "Snapshot",
        pieceCount: 750,
      },
    });
    const open = await addCompletion(t, w.ann, {
      isCompleted: false,
      endDate: undefined,
    });
    await addCompletion(t, w.bob);

    const rows = await indexOf(t, "ann");
    expect(rows.map((row) => row._id).sort()).toEqual([done, open].sort());
    expect(rows.find((row) => row._id === done)).toEqual({
      _id: done,
      isCompleted: true,
      startDate: 10,
      endDate: 99,
      datePrecision: "year",
      pieceCount: 750,
    });
    expect(rows.find((row) => row._id === open)).toEqual({
      _id: open,
      isCompleted: false,
      startDate: 10,
    });
  });

  test("a legacy row without a snapshot takes its piece count from the puzzle", async () => {
    await addCompletion(t, w.ann, { puzzleId: w.puzzleId });
    await addCompletion(t, w.ann, { ownedPuzzleId: w.copyId });
    const rows = await indexOf(t, "ann");
    expect(rows.map((row) => row.pieceCount)).toEqual([1000, 1000]);
  });

  test("past the cap the newest solves stay", async () => {
    const ids = await t.run(async (ctx) => {
      const out: Id<"completions">[] = [];
      for (let i = 0; i <= COMPLETION_INDEX_CAP; i++) {
        out.push(
          await ctx.db.insert("completions", {
            userId: w.ann,
            startDate: 1,
            photos: [],
            isCompleted: true,
            createdAt: 1,
            updatedAt: 1,
          }),
        );
      }
      return out;
    });
    const rows = await indexOf(t, "ann");
    expect(rows).toHaveLength(COMPLETION_INDEX_CAP);
    expect(rows.map((row) => row._id)).toContain(ids[COMPLETION_INDEX_CAP]);
    expect(rows.map((row) => row._id)).not.toContain(ids[0]);
  });
});

describe("solving.myCompletionsByIds", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.solving.getMyCompletionsByIds.getMyCompletionsByIds, {
        completionIds: [],
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("the full rows asked for, in that order, with what a row renders", async () => {
    const a = await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyId,
      puzzleId: w.puzzleId,
      notes: "a note",
    });
    const b = await addCompletion(t, w.ann);
    const rows = await rowsOf(t, "ann", [b, a]);
    expect(rows.map((row) => row._id)).toEqual([b, a]);
    expect(rows[1].notes).toBe("a note");
    expect(rows[1].libraryInfo).toEqual({
      title: "Harbour Lights",
      pieceCount: 1000,
    });
    expect(rows[1].link).toEqual({ kind: "myCopy", id: w.copyId });
    expect(rows[1]).toHaveProperty("photoItems");
    expect(rows[1]).not.toHaveProperty("photos");
    expect(rows[0].libraryInfo).toBeUndefined();
  });

  test("another member's solve is not returned, nor a deleted one", async () => {
    const theirs = await addCompletion(t, w.bob, { notes: "bob's note" });
    const gone = await addCompletion(t, w.ann);
    const mine = await addCompletion(t, w.ann);
    await t.run((ctx) => ctx.db.delete(gone));
    const rows = await rowsOf(t, "ann", [theirs, gone, mine]);
    expect(rows.map((row) => row._id)).toEqual([mine]);
  });

  test("a copy that changed hands gives no library info", async () => {
    const copyOfBob = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: w.puzzleId,
        ownerId: w.bob,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const row = await addCompletion(t, w.ann, { ownedPuzzleId: copyOfBob });
    const [view] = await rowsOf(t, "ann", [row]);
    expect(view.libraryInfo).toBeUndefined();
  });

  // SEC-34: the log says of a copy what My Puzzles says of it (toCopyPuzzleView). The owner of a copy
  // of someone else's pending or rejected definition reads the copy's snapshot, never its live text.
  describe("a copy of a definition that isn't approved", () => {
    const logAgainst = async (
      status: Doc<"puzzles">["status"],
      submittedBy: Id<"users">,
    ) => {
      await t.run(async (ctx) => {
        await ctx.db.patch(w.puzzleId, {
          status,
          submittedBy,
          title: "Live title",
          pieceCount: 999,
        });
        await ctx.db.patch(w.copyId, {
          snapshot: { title: "Snapshot title", pieceCount: 500 },
        });
      });
      const id = await addCompletion(t, w.ann, { ownedPuzzleId: w.copyId });
      const [row] = await rowsOf(t, "ann", [id]);
      return row.libraryInfo;
    };

    test.each(["pending", "rejected"] as const)(
      "someone else's %s definition reads as the copy's snapshot",
      async (status) => {
        expect(await logAgainst(status, w.bob)).toEqual({
          title: "Snapshot title",
          pieceCount: 500,
        });
      },
    );

    test.each(["pending", "rejected"] as const)(
      "their own %s submission keeps its live title",
      async (status) => {
        expect(await logAgainst(status, w.ann)).toEqual({
          title: "Live title",
          pieceCount: 999,
        });
      },
    );

    test("a disabled definition, moderated once, keeps its live title", async () => {
      expect(await logAgainst("disabled", w.bob)).toEqual({
        title: "Live title",
        pieceCount: 999,
      });
    });

    test("agrees with what My Puzzles shows the same copy", async () => {
      const info = await logAgainst("rejected", w.bob);
      const library = await t
        .withIdentity({ subject: "clerk_ann" })
        .query(api.library.getMyLibraryCopies.getMyLibraryCopies, {
          copyIds: [w.copyId],
        });
      expect(library[0].puzzle?.title).toBe(info?.title);
      expect(library[0].puzzle?.pieceCount).toBe(info?.pieceCount);
    });
  });

  test("reads at most COMPLETION_ROWS_MAX ids, repeats counted once", async () => {
    const id = await addCompletion(t, w.ann);
    const rows = await rowsOf(
      t,
      "ann",
      Array.from({ length: COMPLETION_ROWS_MAX + 5 }, () => id),
    );
    expect(rows).toHaveLength(1);
  });
});
